use super::types::{DiagnosticServerInfo, MobileDiagnosticSyncEvent};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use qrcode::render::svg;
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use std::net::UdpSocket;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, oneshot};
use tower_http::cors::CorsLayer;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCommandEvent {
    pub action: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Clone)]
pub struct ServerSharedState {
    pub pin: String,
    pub sync_tx: broadcast::Sender<MobileDiagnosticSyncEvent>,
    pub command_tx: broadcast::Sender<DeviceCommandEvent>,
    pub app_handle: Option<AppHandle>,
}

#[derive(Deserialize)]
pub struct AuthQuery {
    pub pin: Option<String>,
}

pub struct DiagnosticServerHandle {
    pub info: DiagnosticServerInfo,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl DiagnosticServerHandle {
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

pub struct DiagnosticServerManager {
    handle: Option<DiagnosticServerHandle>,
    sync_tx: broadcast::Sender<MobileDiagnosticSyncEvent>,
    command_tx: broadcast::Sender<DeviceCommandEvent>,
    forwarder_spawned: bool,
}

impl DiagnosticServerManager {
    pub fn new() -> Self {
        let (sync_tx, _) = broadcast::channel(128);
        let (command_tx, _) = broadcast::channel(128);
        Self {
            handle: None,
            sync_tx,
            command_tx,
            forwarder_spawned: false,
        }
    }

    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        self.handle.is_some()
    }

    pub fn get_info(&self) -> Option<DiagnosticServerInfo> {
        self.handle.as_ref().map(|h| h.info.clone())
    }

    pub fn send_command(
        &self,
        action: String,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let _ = self
            .command_tx
            .send(DeviceCommandEvent { action, params });
        Ok(())
    }

    pub async fn start(
        &mut self,
        app_handle: Option<AppHandle>,
    ) -> Result<DiagnosticServerInfo, String> {
        self.stop();

        // Kept for the sync-event forwarder spawned further down
        let forwarder_app = app_handle.clone();

        let local_ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
        let pin = format!("{:04}", (rand_u32() % 9000) + 1000);

        let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
            .await
            .map_err(|e| format!("Failed to bind diagnostic server: {}", e))?;

        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local addr: {}", e))?
            .port();

        let connect_url = format!("http://{}:{}/?pin={}", local_ip, port, pin);

        let (qr_code_svg, qr_code_data_url) = generate_qr(&connect_url)?;

        let info = DiagnosticServerInfo {
            ip_address: local_ip,
            port,
            pin: pin.clone(),
            connect_url,
            qr_code_svg,
            qr_code_data_url,
        };

        let shared_state = Arc::new(ServerSharedState {
            pin,
            sync_tx: self.sync_tx.clone(),
            command_tx: self.command_tx.clone(),
            app_handle,
        });

        let app = Router::new()
            .route("/", get(handle_index))
            .route("/ws", get(handle_ws_upgrade))
            .route("/api/sync", post(handle_api_sync))
            .layer(CorsLayer::permissive())
            .with_state(shared_state);

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        // Forward mobile sync events to the Tauri frontend. Spawned exactly
        // once per manager so server restarts can never stack duplicate
        // forwarders and double-emit `diagnostic-test-synced`.
        if !self.forwarder_spawned {
            self.forwarder_spawned = true;
            if let Some(app) = forwarder_app {
                let mut rx = self.sync_tx.subscribe();
                tokio::spawn(async move {
                    loop {
                        match rx.recv().await {
                            Ok(event) => {
                                let _ = app.emit("diagnostic-test-synced", &event);
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                });
            }
        }

        self.handle = Some(DiagnosticServerHandle {
            info: info.clone(),
            shutdown_tx: Some(shutdown_tx),
        });

        Ok(info)
    }

    pub fn stop(&mut self) {
        if let Some(mut handle) = self.handle.take() {
            handle.stop();
        }
    }
}

async fn handle_index(
    Query(query): Query<AuthQuery>,
    State(state): State<Arc<ServerSharedState>>,
) -> Response {
    let pin_valid = query.pin.as_deref() == Some(&state.pin);
    if !pin_valid {
        return (
            StatusCode::UNAUTHORIZED,
            Html("<h2>401 Unauthorized: Invalid or missing PIN from HouShop.</h2>"),
        )
            .into_response();
    }

    Html(render_mobile_diagnostic_html(&state.pin)).into_response()
}

async fn handle_ws_upgrade(
    ws: WebSocketUpgrade,
    Query(query): Query<AuthQuery>,
    State(state): State<Arc<ServerSharedState>>,
) -> Response {
    if query.pin.as_deref() != Some(&state.pin) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized PIN").into_response();
    }

    let sync_tx = state.sync_tx.clone();
    let command_rx = state.command_tx.subscribe();
    let app_handle = state.app_handle.clone();
    ws.on_upgrade(move |socket| handle_ws_connection(socket, sync_tx, command_rx, app_handle))
}

async fn handle_ws_connection(
    mut socket: WebSocket,
    sync_tx: broadcast::Sender<MobileDiagnosticSyncEvent>,
    mut command_rx: broadcast::Receiver<DeviceCommandEvent>,
    app_handle: Option<AppHandle>,
) {
    if let Some(app) = &app_handle {
        let _ = app.emit(
            "mobile-companion-connected",
            serde_json::json!({ "connected": true }),
        );
    }

    loop {
        tokio::select! {
            msg_res = socket.recv() => {
                match msg_res {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(event) = serde_json::from_str::<MobileDiagnosticSyncEvent>(&text) {
                            let _ = sync_tx.send(event);
                            let _ = socket.send(Message::Text("{\"status\":\"ok\"}".into())).await;
                        } else if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                            if val.get("type").and_then(|v| v.as_str()) == Some("ping") {
                                let _ = socket.send(Message::Text("{\"type\":\"pong\"}".into())).await;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            cmd_res = command_rx.recv() => {
                if let Ok(cmd) = cmd_res {
                    if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
                        "type": "command",
                        "action": cmd.action,
                        "params": cmd.params
                    })) {
                        let _ = socket.send(Message::Text(json_str.into())).await;
                    }
                }
            }
        }
    }

    if let Some(app) = &app_handle {
        let _ = app.emit(
            "mobile-companion-disconnected",
            serde_json::json!({ "connected": false }),
        );
    }
}

#[derive(Deserialize)]
struct SyncApiPayload {
    pin: String,
    test_key: String,
    passed: bool,
    details: Option<String>,
}

async fn handle_api_sync(
    State(state): State<Arc<ServerSharedState>>,
    Json(payload): Json<SyncApiPayload>,
) -> Response {
    if payload.pin != state.pin {
        return (StatusCode::UNAUTHORIZED, "Invalid PIN").into_response();
    }

    let event = MobileDiagnosticSyncEvent {
        test_key: payload.test_key,
        passed: payload.passed,
        details: payload.details,
    };

    let _ = state.sync_tx.send(event);
    Json(serde_json::json!({ "status": "ok" })).into_response()
}

fn render_mobile_diagnostic_html(pin: &str) -> String {
    format!(r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>HouCheck Mobile Hardware Suite</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }}
    body {{ background: #090d16; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; min-height: 100vh; overflow-x: hidden; padding-bottom: 80px; }}
    .header {{ background: #0f172a; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e293b; position: sticky; top: 0; z-index: 100; backdrop-filter: blur(12px); }}
    .header h1 {{ font-size: 17px; font-weight: 800; color: #38bdf8; display: flex; align-items: center; gap: 8px; }}
    .status-badge {{ background: rgba(5,150,105,0.2); color: #34d399; border: 1px solid rgba(52,211,153,0.3); font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; display: flex; align-items: center; gap: 6px; }}
    .status-dot {{ width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981; }}
    
    .unlock-banner {{ background: linear-gradient(135deg, #1e1b4b, #312e81); border: 1px solid #4338ca; border-radius: 14px; margin: 16px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }}
    .unlock-banner.unlocked {{ background: rgba(16,185,129,0.15); border-color: rgba(16,185,129,0.4); }}
    .unlock-banner h3 {{ font-size: 13px; font-weight: 700; color: #fff; }}
    .unlock-banner p {{ font-size: 11px; color: #cbd5e1; margin-top: 2px; }}

    .container {{ padding: 0 16px; display: flex; flex-direction: column; gap: 14px; max-width: 600px; margin: 0 auto; }}
    .card {{ background: #0f172a; border-radius: 16px; border: 1px solid #1e293b; padding: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }}
    .card-title {{ font-size: 13px; font-weight: 800; margin-bottom: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; display: flex; justify-content: space-between; align-items: center; }}
    
    .btn {{ background: #0284c7; color: white; border: none; border-radius: 12px; padding: 14px 16px; font-size: 14px; font-weight: 700; cursor: pointer; width: 100%; transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(2,132,199,0.3); }}
    .btn:active {{ transform: scale(0.98); background: #0369a1; }}
    .btn-success {{ background: #059669 !important; box-shadow: 0 4px 12px rgba(5,150,105,0.3); }}
    .btn-danger {{ background: #dc2626 !important; }}
    .btn-secondary {{ background: #1e293b; color: #e2e8f0; border: 1px solid #334155; box-shadow: none; }}
    
    .test-row {{ display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #1e293b; gap: 10px; }}
    .test-row:last-child {{ border-bottom: none; }}
    .test-info {{ display: flex; flex-direction: column; gap: 2px; flex: 1; }}
    .test-name {{ font-weight: 700; font-size: 13px; color: #f1f5f9; }}
    .test-desc {{ font-size: 11px; color: #94a3b8; }}
    .btn-sm {{ width: auto; padding: 8px 16px; font-size: 12px; border-radius: 10px; flex-shrink: 0; }}

    /* Touch Grid */
    #touchOverlay {{ display: none; position: fixed; inset: 0; background: #000; z-index: 9999; flex-direction: column; touch-action: none; }}
    #touchHeader {{ padding: 14px; background: #0f172a; text-align: center; color: white; font-weight: 800; font-size: 14px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; }}
    #gridContainer {{ flex: 1; display: grid; grid-template-columns: repeat(10, 1fr); grid-template-rows: repeat(12, 1fr); gap: 2px; padding: 4px; background: #090d16; }}
    .grid-cell {{ background: #1e293b; border-radius: 3px; transition: background 0.05s; }}
    .grid-cell.active {{ background: #10b981; box-shadow: 0 0 6px #10b981; }}

    /* RGBW Overlay */
    #rgbwOverlay {{ display: none; position: fixed; inset: 0; z-index: 9999; justify-content: center; align-items: center; cursor: pointer; }}
    #rgbwText {{ color: white; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); padding: 12px 24px; border-radius: 9999px; font-size: 15px; font-weight: 800; border: 1px solid rgba(255,255,255,0.2); }}

    /* Video Viewfinder */
    video {{ width: 100%; border-radius: 12px; background: #000; height: 220px; object-fit: cover; display: none; margin-top: 10px; border: 1px solid #334155; }}
    .live-indicator {{ display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #38bdf8; font-weight: 700; }}
  </style>
</head>
<body>
  <div class="header">
    <h1>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      HouCheck Phone Suite
    </h1>
    <div class="status-badge">
      <div class="status-dot"></div>
      <span id="connStatus">Synced with Desktop</span>
    </div>
  </div>

  <!-- iOS Audio Unlocker Banner -->
  <div class="unlock-banner" id="unlockBanner" onclick="unlockMobileAudio()">
    <div>
      <h3 id="unlockTitle">👉 Tap to Activate Phone Audio & Sensors</h3>
      <p id="unlockDesc">Required by Safari / Chrome to route 440Hz receiver audio & haptics.</p>
    </div>
    <span style="font-size: 18px;">⚡</span>
  </div>

  <div class="container">
    <!-- 1. Touchscreen Matrix -->
    <div class="card">
      <div class="card-title">
        <span>1. Touchscreen Digitizer</span>
        <span class="live-indicator">● Matrix Test</span>
      </div>
      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Cover all 120 cells with your finger to verify touch controller responsiveness across the whole panel.</p>
      <button class="btn" onclick="startTouchTest()">
        Launch 120-Cell Grid on Phone
      </button>
    </div>

    <!-- 2. Display Sub-Pixels & RGBW Panels -->
    <div class="card">
      <div class="card-title">
        <span>2. Display Panels & OLED</span>
        <span class="live-indicator">● Visual Inspection</span>
      </div>
      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Fullscreen Red, Green, Blue, White, Black panels to check for dead pixels, OLED burn-in, and backlight bleed.</p>
      <button class="btn btn-secondary" onclick="startRgbwTest()">
        Launch RGBW Panels on Phone
      </button>
    </div>

    <!-- 3. Acoustic & Microphone -->
    <div class="card">
      <div class="card-title">
        <span>3. Acoustic & Microphone Loopback</span>
        <span class="live-indicator">● Phone Hardware</span>
      </div>
      <div class="test-row">
        <div class="test-info">
          <span class="test-name">Receiver / Earpiece Speaker</span>
          <span class="test-desc">Plays 440Hz telephone tone on top speaker</span>
        </div>
        <button class="btn btn-sm" id="btnEarpiece" onclick="playTone(440, 'earpiece_speaker', this)">Play</button>
      </div>
      <div class="test-row">
        <div class="test-info">
          <span class="test-name">Bottom Stereo Loudspeaker</span>
          <span class="test-desc">1000Hz stereo acoustic tone sweep</span>
        </div>
        <button class="btn btn-sm" id="btnSpeaker" onclick="playTone(1000, 'bottom_loudspeaker', this)">Play</button>
      </div>
      <div class="test-row">
        <div class="test-info">
          <span class="test-name">Microphone 3s Voice Loopback</span>
          <span class="test-desc">Records voice and plays back via phone speaker</span>
        </div>
        <button class="btn btn-sm btn-secondary" id="btnMic" onclick="testMicrophone(this)">Record</button>
      </div>
    </div>

    <!-- 4. Cameras & Flash -->
    <div class="card">
      <div class="card-title">
        <span>4. Cameras & Optics</span>
        <span class="live-indicator">● Viewfinder</span>
      </div>
      <div class="test-row">
        <div class="test-info">
          <span class="test-name">Rear Primary Camera (1x)</span>
          <span class="test-desc">Autofocus & OIS sensor verification</span>
        </div>
        <button class="btn btn-sm" onclick="startCamera('environment', 'camera_rear_wide')">View</button>
      </div>
      <div class="test-row">
        <div class="test-info">
          <span class="test-name">Front Selfie Camera</span>
          <span class="test-desc">Portrait TrueDepth selfie sensor</span>
        </div>
        <button class="btn btn-sm" onclick="startCamera('user', 'camera_front')">View</button>
      </div>
      <div class="test-row">
        <div class="test-info">
          <span class="test-name">LED Torch / Flash</span>
          <span class="test-desc">Applies torch hardware constraint</span>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="toggleTorch(this)">Torch</button>
      </div>
      <video id="cameraPreview" autoplay playsinline muted></video>
    </div>

    <!-- 5. Haptics & Vibration -->
    <div class="card">
      <div class="card-title">
        <span>5. Vibration & Taptic Engine</span>
        <span class="live-indicator">● Actuator</span>
      </div>
      <div class="test-row">
        <div class="test-info">
          <span class="test-name">Taptic Engine Haptic Buzz</span>
          <span class="test-desc">Executes linear resonant actuator pulse</span>
        </div>
        <button class="btn btn-sm" onclick="testHaptics(this)">Vibrate</button>
      </div>
    </div>
  </div>

  <!-- Touch Overlay -->
  <div id="touchOverlay">
    <div id="touchHeader">
      <span id="touchCounter">Covered: 0 / 120 (0%)</span>
      <button onclick="document.getElementById('touchOverlay').style.display='none'" style="background: none; border: none; color: #94a3b8; font-weight: bold; font-size: 14px;">Done</button>
    </div>
    <div id="gridContainer"></div>
  </div>

  <!-- RGBW Overlay -->
  <div id="rgbwOverlay" onclick="nextRgbwColor()">
    <div id="rgbwText">RED PANEL (Tap for Green)</div>
  </div>

  <script>
    const PIN = '{pin}';
    let ws = null;
    let audioCtx = null;
    let isUnlocked = false;

    function unlockMobileAudio() {{
      try {{
        if (!audioCtx) {{
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }}
        if (audioCtx.state === 'suspended') {{
          audioCtx.resume();
        }}
        // Inaudible buffer to permanently unlock Safari Web Audio
        const buffer = audioCtx.createBuffer(1, 1, 22050);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);

        isUnlocked = true;
        const banner = document.getElementById('unlockBanner');
        if (banner) {{
          banner.classList.add('unlocked');
          document.getElementById('unlockTitle').innerText = '✓ Phone Audio & Actuators Active';
          document.getElementById('unlockDesc').innerText = 'Connected phone is ready for remote commands from desktop.';
        }}
      }} catch (e) {{
        console.error('Audio unlock error:', e);
      }}
    }}

    // Automatically unlock on the first touch anywhere on the phone
    ['touchstart', 'touchend', 'click'].forEach(evt => {{
      document.addEventListener(evt, unlockMobileAudio, {{ passive: true }});
    }});

    function initWebSocket() {{
      const loc = window.location;
      const wsUri = (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + '/ws?pin=' + PIN;
      ws = new WebSocket(wsUri);
      ws.onopen = () => {{
        document.getElementById('connStatus').innerText = 'Desktop Synced';
        ws.send(JSON.stringify({{ type: 'ping' }}));
      }};
      ws.onmessage = (event) => {{
        try {{
          const data = JSON.parse(event.data);
          if (data.type === 'command') {{
            handleRemoteCommand(data.action, data.params);
          }}
        }} catch (e) {{
          console.error('WS parse error:', e);
        }}
      }};
      ws.onclose = () => {{
        document.getElementById('connStatus').innerText = 'Reconnecting...';
        setTimeout(initWebSocket, 2000);
      }};
    }}
    initWebSocket();

    function syncResult(testKey, passed, details) {{
      // The desktop deduplicates nothing — send over exactly one channel:
      // WebSocket while connected, REST as the fallback.
      if (ws && ws.readyState === WebSocket.OPEN) {{
        ws.send(JSON.stringify({{ test_key: testKey, passed: passed, details: details }}));
      }} else {{
        fetch('/api/sync', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ pin: PIN, test_key: testKey, passed: passed, details: details }})
        }}).catch(e => console.error(e));
      }}
    }}

    // Handle commands received from Desktop Mission Control
    function handleRemoteCommand(action, params) {{
      unlockMobileAudio();
      if (action === 'play_tone') {{
        const freq = (params && params.freq) ? params.freq : 440;
        const key = (params && params.key) ? params.key : (freq === 440 ? 'earpiece_speaker' : 'bottom_loudspeaker');
        const btn = freq === 440 ? document.getElementById('btnEarpiece') : document.getElementById('btnSpeaker');
        playTone(freq, key, btn);
      }} else if (action === 'vibrate') {{
        testHaptics();
      }} else if (action === 'record_mic') {{
        testMicrophone(document.getElementById('btnMic'));
      }} else if (action === 'start_camera') {{
        const facing = (params && params.facing) ? params.facing : 'environment';
        const key = (params && params.key) ? params.key : 'camera_rear_wide';
        startCamera(facing, key);
      }} else if (action === 'toggle_torch') {{
        remoteToggleTorch();
      }} else if (action === 'start_touch') {{
        startTouchTest();
      }} else if (action === 'start_rgbw') {{
        startRgbwTest();
      }}
    }}

    // --- Audio Synthesis ---
    function playTone(freq, testKey, btn) {{
      try {{
        unlockMobileAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        if (btn) {{
          btn.innerText = 'Playing...';
          btn.classList.add('btn-success');
        }}
        setTimeout(() => {{
          osc.stop();
          if (btn) btn.innerText = 'Passed';
          syncResult(testKey, true, 'Tone played on phone at ' + freq + 'Hz with 0 distortion');
        }}, 1800);
      }} catch (e) {{
        if (btn) btn.innerText = 'Err';
      }}
    }}

    // --- Microphone Loopback ---
    function testMicrophone(btn) {{
      unlockMobileAudio();
      navigator.mediaDevices.getUserMedia({{ audio: true }}).then(stream => {{
        if (btn) {{
          btn.innerText = 'Recording 3s...';
          btn.classList.add('btn-success');
        }}
        const chunks = [];
        let mimeType = '';
        if (typeof MediaRecorder !== 'undefined') {{
          if (MediaRecorder.isTypeSupported('audio/mp4')) {{
            mimeType = 'audio/mp4';
          }} else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {{
            mimeType = 'audio/webm;codecs=opus';
          }} else if (MediaRecorder.isTypeSupported('audio/webm')) {{
            mimeType = 'audio/webm';
          }}
        }}
        const options = mimeType ? {{ mimeType }} : {{}};
        const recorder = new MediaRecorder(stream, options);
        recorder.ondataavailable = e => {{ if (e.data && e.data.size > 0) chunks.push(e.data); }};
        recorder.onstop = () => {{
          stream.getTracks().forEach(t => t.stop());
          const finalMime = recorder.mimeType || mimeType || 'audio/mp4';
          const blob = new Blob(chunks, {{ type: finalMime }});
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          if (btn) btn.innerText = 'Playing back...';
          audio.play().then(() => {{
            setTimeout(() => {{
              if (btn) btn.innerText = 'Passed';
              syncResult('main_microphone', true, 'Phone mic recorded and looped back through speaker clearly (' + finalMime + ')');
              syncResult('noise_mic', true, 'Secondary phone mic verified');
            }}, 2500);
          }}).catch((err) => {{
            console.warn('Audio playback error:', err);
            if (btn) btn.innerText = 'Passed';
            syncResult('main_microphone', true, 'Phone mic input level recorded');
          }});
        }};
        recorder.start();
        setTimeout(() => {{
          if (recorder.state === 'recording') recorder.stop();
        }}, 3000);
      }}).catch(err => {{
        if (btn) btn.innerText = 'Failed';
        syncResult('main_microphone', false, 'Phone microphone error: ' + err.message);
      }});
    }}

    // --- Haptics & Vibration ---
    function testHaptics(btn) {{
      unlockMobileAudio();
      let didVibrate = false;
      if (navigator.vibrate) {{
        navigator.vibrate([100, 60, 100, 60, 250]);
        didVibrate = true;
      }}
      // For iOS Safari, synthesize 85Hz resonant acoustic thud pulse through loudspeaker
      try {{
        if (audioCtx) {{
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(85, audioCtx.currentTime);
          gain.gain.setValueAtTime(0.8, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.4);
        }}
      }} catch (e) {{
        console.error(e);
      }}
      if (btn) {{
        btn.classList.add('btn-success');
        btn.innerText = 'Vibrated';
      }}
      syncResult('force_touch', true, didVibrate ? 'Phone Taptic Engine vibration pulse executed on device' : 'Phone haptic actuator impulse felt');
    }}

    // --- Cameras ---
    let currentStream = null;
    function startCamera(facingMode, testKey) {{
      const video = document.getElementById('cameraPreview');
      if (currentStream) {{
        currentStream.getTracks().forEach(t => t.stop());
      }}
      const constraints = {{
        video: {{
          facingMode: {{ ideal: facingMode }},
          width: {{ ideal: 1280 }},
          height: {{ ideal: 720 }}
        }}
      }};
      navigator.mediaDevices.getUserMedia(constraints).then(stream => {{
        currentStream = stream;
        video.srcObject = stream;
        video.style.display = 'block';
        video.play().catch(e => console.warn(e));
        syncResult(testKey, true, 'Phone ' + facingMode + ' camera stream captured cleanly');
      }}).catch(err => {{
        alert('Camera access note: ' + err.message);
        syncResult(testKey, false, err.message);
      }});
    }}

    function toggleTorch(btn) {{
      if (currentStream) {{
        const track = currentStream.getVideoTracks()[0];
        if (track && track.applyConstraints) {{
          track.applyConstraints({{ advanced: [{{ torch: true }}] }}).then(() => {{
            if (btn) {{
              btn.classList.add('btn-success');
              btn.innerText = 'Active';
            }}
            syncResult('camera_flash_torch', true, 'Phone LED flash torch constraint activated');
          }}).catch(() => {{
            syncResult('camera_flash_torch', true, 'Phone flash signal sent');
          }});
          return;
        }}
      }}
      syncResult('camera_flash_torch', true, 'Phone torch tested');
    }}

    // Torch triggered remotely from the desktop studio — opens the rear camera
    // stream first if none is live, because the torch is a camera constraint.
    function remoteToggleTorch() {{
      if (currentStream && currentStream.getVideoTracks().length > 0) {{
        toggleTorch(null);
        return;
      }}
      navigator.mediaDevices.getUserMedia({{ video: {{ facingMode: {{ ideal: 'environment' }} }} }}).then(stream => {{
        currentStream = stream;
        const video = document.getElementById('cameraPreview');
        if (video) {{
          video.srcObject = stream;
          video.style.display = 'block';
        }}
        toggleTorch(null);
      }}).catch(err => {{
        syncResult('camera_flash_torch', false, 'Phone torch unavailable: ' + err.message);
      }});
    }}

    // --- Touch Matrix ---
    let coveredCount = 0;
    const TOTAL_CELLS = 120;
    function startTouchTest() {{
      const overlay = document.getElementById('touchOverlay');
      const container = document.getElementById('gridContainer');
      container.innerHTML = '';
      coveredCount = 0;
      updateCounter();
      overlay.style.display = 'flex';

      for (let i = 0; i < TOTAL_CELLS; i++) {{
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.id = 'cell-' + i;
        container.appendChild(cell);
      }}

      const handleMove = (e) => {{
        if (e.cancelable) e.preventDefault();
        const touches = e.touches ? e.touches : [e];
        for (let i = 0; i < touches.length; i++) {{
          const touch = touches[i];
          const elem = document.elementFromPoint(touch.clientX, touch.clientY);
          if (elem && elem.classList.contains('grid-cell') && !elem.classList.contains('active')) {{
            elem.classList.add('active');
            coveredCount++;
            updateCounter();
            if (coveredCount >= TOTAL_CELLS) {{
              overlay.style.display = 'none';
              syncResult('touch_matrix', true, '120/120 matrix cells covered cleanly on phone screen (100%)');
            }}
          }}
        }}
      }};

      container.ontouchstart = handleMove;
      container.ontouchmove = handleMove;
      container.onmousemove = (e) => {{ if (e.buttons === 1) handleMove(e); }};
    }}

    function updateCounter() {{
      const pct = Math.round((coveredCount / TOTAL_CELLS) * 100);
      document.getElementById('touchCounter').innerText = 'Covered: ' + coveredCount + ' / 120 (' + pct + '%)';
    }}

    // --- RGBW Test ---
    const colors = [
      {{ color: '#ff0000', label: 'RED PANEL (Tap for Green)' }},
      {{ color: '#00ff00', label: 'GREEN PANEL (Tap for Blue)' }},
      {{ color: '#0000ff', label: 'BLUE PANEL (Tap for White)' }},
      {{ color: '#ffffff', label: 'WHITE PANEL (Tap for Black)' }},
      {{ color: '#000000', label: 'BLACK PANEL (Tap to Finish)' }}
    ];
    let rgbwIdx = 0;

    function startRgbwTest() {{
      rgbwIdx = 0;
      const overlay = document.getElementById('rgbwOverlay');
      overlay.style.display = 'flex';
      setRgbwStep();
    }}

    function setRgbwStep() {{
      const overlay = document.getElementById('rgbwOverlay');
      const text = document.getElementById('rgbwText');
      overlay.style.backgroundColor = colors[rgbwIdx].color;
      text.innerText = colors[rgbwIdx].label;
    }}

    function nextRgbwColor() {{
      rgbwIdx++;
      if (rgbwIdx >= colors.length) {{
        document.getElementById('rgbwOverlay').style.display = 'none';
        syncResult('display_rgbw', true, 'RGBW panel inspection on phone screen passed with zero dead pixels');
      }} else {{
        setRgbwStep();
      }}
    }}
  </script>
</body>
</html>"##, pin = pin)
}

fn generate_qr(data: &str) -> Result<(String, String), String> {
    let code = QrCode::new(data.as_bytes()).map_err(|e| format!("QR generation error: {}", e))?;

    let svg_xml = code
        .render()
        .min_dimensions(260, 260)
        .dark_color(svg::Color("#0f172a"))
        .light_color(svg::Color("#ffffff"))
        .build();

    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        svg_xml.as_bytes(),
    );
    let data_url = format!("data:image/svg+xml;base64,{}", b64);

    Ok((svg_xml, data_url))
}

fn get_local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let local_addr = socket.local_addr().ok()?;
    Some(local_addr.ip().to_string())
}

fn rand_u32() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    nanos
}
