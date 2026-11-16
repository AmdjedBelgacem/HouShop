use super::types::WifiServerInfo;
use axum::{
    extract::{Multipart, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use qrcode::render::svg;
use qrcode::QrCode;
use serde::Deserialize;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::oneshot;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct ServerSharedState {
    pub pin: String,
    pub upload_dir: PathBuf,
    pub active_connections: Arc<AtomicUsize>,
}

pub struct WifiServerHandle {
    pub info: WifiServerInfo,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl WifiServerHandle {
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

pub struct WifiServerManager {
    handle: Option<WifiServerHandle>,
}

impl WifiServerManager {
    pub fn new() -> Self {
        Self { handle: None }
    }

    pub fn is_running(&self) -> bool {
        self.handle.is_some()
    }

    pub fn get_info(&self) -> Option<WifiServerInfo> {
        self.handle.as_ref().map(|h| h.info.clone())
    }

    pub async fn start(&mut self, upload_dir: PathBuf) -> Result<WifiServerInfo, String> {
        self.stop();

        let local_ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
        // Generate random 4-digit PIN
        let pin = format!("{:04}", (rand_u32() % 9000) + 1000);

        // Find available port starting from 8990
        let mut port = 8990;
        let mut listener = None;
        for p in 8990..9050 {
            if let Ok(l) = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", p)).await {
                port = p;
                listener = Some(l);
                break;
            }
        }

        let listener = listener.ok_or_else(|| "Failed to find available port for Wi-Fi server".to_string())?;

        let connect_url = format!("http://{}:{}/?pin={}", local_ip, port, pin);

        // Generate QR code SVG and Data URL
        let (qr_svg, qr_data_url) = generate_qr(&connect_url)?;

        let active_connections = Arc::new(AtomicUsize::new(0));

        let shared_state = ServerSharedState {
            pin: pin.clone(),
            upload_dir: upload_dir.clone(),
            active_connections: active_connections.clone(),
        };

        let app = Router::new()
            .route("/", get(handle_index))
            .route("/upload", post(handle_upload))
            .route("/status", get(handle_status))
            .layer(CorsLayer::permissive())
            .with_state(shared_state);

        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        // Spawn Axum server in background Tokio task
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        let info = WifiServerInfo {
            ip_address: local_ip,
            port,
            pin,
            qr_code_svg: qr_svg,
            qr_code_data_url: qr_data_url,
            connect_url,
            active_connections: 0,
        };

        self.handle = Some(WifiServerHandle {
            info: info.clone(),
            shutdown_tx: Some(shutdown_tx),
        });

        Ok(info)
    }

    pub fn stop(&mut self) {
        if let Some(mut h) = self.handle.take() {
            h.stop();
        }
    }
}

// ============================================================================
// AXUM WEB HANDLERS
// ============================================================================

#[derive(Deserialize)]
struct AuthQuery {
    pin: Option<String>,
}

async fn handle_index(
    State(state): State<ServerSharedState>,
    Query(q): Query<AuthQuery>,
) -> Response {
    let pin_valid = q.pin.as_deref() == Some(&state.pin);

    if !pin_valid {
        return Html(render_pin_prompt(&state.pin)).into_response();
    }

    state.active_connections.fetch_add(1, Ordering::SeqCst);
    Html(render_upload_portal(&state.pin)).into_response()
}

async fn handle_status(
    State(state): State<ServerSharedState>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "online",
        "active_connections": state.active_connections.load(Ordering::SeqCst),
    }))
}

async fn handle_upload(
    State(state): State<ServerSharedState>,
    Query(q): Query<AuthQuery>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if q.pin.as_deref() != Some(&state.pin) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid PIN".to_string()));
    }

    let mut saved_files = 0;
    let mut total_bytes = 0u64;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.file_name().unwrap_or("unnamed_file").to_string();
        let safe_name = sanitize_filename(&name);
        let dest_path = state.upload_dir.join(&safe_name);

        if let Ok(bytes) = field.bytes().await {
            total_bytes += bytes.len() as u64;
            if std::fs::write(&dest_path, &bytes).is_ok() {
                saved_files += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "saved_files": saved_files,
        "total_bytes": total_bytes,
    })))
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .collect()
}

// ============================================================================
// LOCAL IP & QR CODE HELPERS
// ============================================================================

fn get_local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

fn generate_qr(data: &str) -> Result<(String, String), String> {
    let code = QrCode::new(data.as_bytes()).map_err(|e| format!("QR generation error: {}", e))?;

    let svg_xml = code
        .render()
        .min_dimensions(240, 240)
        .dark_color(svg::Color("#1e293b"))
        .light_color(svg::Color("#ffffff"))
        .build();

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, svg_xml.as_bytes());
    let data_url = format!("data:image/svg+xml;base64,{}", b64);

    Ok((svg_xml, data_url))
}

fn rand_u32() -> u32 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros();
    (now ^ (now >> 16)) as u32
}

// ============================================================================
// RESPONSIVE EMBEDDED MOBILE WEB CLIENT
// ============================================================================

fn render_pin_prompt(_expected_pin: &str) -> String {
    format!(r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>HouSwitch - Connect</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }}
    .card {{ background: #1e293b; border-radius: 16px; padding: 28px; width: 100%; max-width: 360px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }}
    h1 {{ font-size: 20px; font-weight: 700; margin: 0 0 8px; color: #38bdf8; }}
    p {{ font-size: 14px; color: #94a3b8; margin: 0 0 20px; }}
    input {{ width: 100%; box-sizing: border-box; padding: 14px; font-size: 20px; text-align: center; letter-spacing: 4px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; color: #fff; margin-bottom: 16px; }}
    button {{ width: 100%; padding: 14px; font-size: 16px; font-weight: 600; background: #0284c7; color: white; border: none; border-radius: 10px; cursor: pointer; }}
    button:active {{ background: #0369a1; }}
  </style>
</head>
<body>
  <div class="card">
    <h1>HouSwitch Wireless</h1>
    <p>Enter the 4-digit PIN shown on the shop screen to authorize transfer.</p>
    <form method="GET" action="/">
      <input type="text" name="pin" maxlength="4" placeholder="0000" pattern="[0-9]*" inputmode="numeric" autofocus required>
      <button type="submit">Connect</button>
    </form>
  </div>
</body>
</html>"#)
}

fn render_upload_portal(pin: &str) -> String {
    format!(r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>HouSwitch - Fast Upload</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; box-sizing: border-box; }}
    .header {{ text-align: center; padding: 16px 0; }}
    .header h1 {{ font-size: 22px; font-weight: 800; color: #38bdf8; margin: 0; }}
    .header p {{ font-size: 13px; color: #94a3b8; margin: 4px 0 0; }}
    .upload-box {{ border: 2px dashed #0284c7; background: #1e293b; border-radius: 16px; padding: 32px 16px; text-align: center; margin: 16px 0; cursor: pointer; }}
    .upload-box svg {{ width: 48px; height: 48px; stroke: #38bdf8; fill: none; stroke-width: 2; margin-bottom: 12px; }}
    .btn {{ display: block; width: 100%; box-sizing: border-box; padding: 14px; font-size: 16px; font-weight: 600; text-align: center; border-radius: 12px; border: none; cursor: pointer; margin-top: 12px; }}
    .btn-primary {{ background: #0284c7; color: white; }}
    .btn-secondary {{ background: #334155; color: white; }}
    #progress-container {{ display: none; margin-top: 16px; }}
    .bar {{ background: #334155; height: 10px; border-radius: 5px; overflow: hidden; }}
    .fill {{ background: #38bdf8; height: 100%; width: 0%; transition: width 0.2s; }}
    .file-list {{ margin-top: 16px; font-size: 12px; color: #94a3b8; max-height: 180px; overflow-y: auto; text-align: left; }}
    .badge {{ display: inline-block; padding: 4px 10px; border-radius: 20px; background: #0369a1; color: #e0f2fe; font-size: 11px; font-weight: 700; margin-bottom: 8px; }}
  </style>
</head>
<body>
  <div class="header">
    <span class="badge">SECURE HIGH-SPEED LINK</span>
    <h1>HouSwitch Transfer</h1>
    <p>Select Photos, Videos, or Files to stream directly to HouShop</p>
  </div>

  <div class="upload-box" onclick="document.getElementById('file-input').click()">
    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
    <div style="font-weight: 600; font-size: 16px;">Tap to select Media or Files</div>
    <div style="font-size: 13px; color: #64748b; margin-top: 4px;">Supports all photo, video, and audio formats</div>
  </div>

  <input type="file" id="file-input" multiple style="display:none" onchange="onFilesSelected(this.files)">

  <div id="progress-container">
    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
      <span id="status-text">Uploading...</span>
      <span id="percent-text">0%</span>
    </div>
    <div class="bar"><div class="fill" id="progress-fill"></div></div>
  </div>

  <div class="file-list" id="file-list"></div>

  <script>
    const PIN = '{pin}';
    let selectedFiles = [];

    function onFilesSelected(files) {{
      selectedFiles = Array.from(files);
      const list = document.getElementById('file-list');
      list.innerHTML = '<b>' + selectedFiles.length + ' item(s) selected:</b><br>' +
        selectedFiles.slice(0, 5).map(f => f.name + ' (' + (f.size/1024/1024).toFixed(1) + ' MB)').join('<br>') +
        (selectedFiles.length > 5 ? '<br><i>...and ' + (selectedFiles.length - 5) + ' more</i>' : '');

      startUpload();
    }}

    function startUpload() {{
      if (selectedFiles.length === 0) return;
      const progressContainer = document.getElementById('progress-container');
      const progressFill = document.getElementById('progress-fill');
      const percentText = document.getElementById('percent-text');
      const statusText = document.getElementById('status-text');

      progressContainer.style.display = 'block';
      statusText.innerText = 'Streaming to HouShop...';

      const formData = new FormData();
      selectedFiles.forEach((file, idx) => {{
        formData.append('file_' + idx, file, file.name);
      }});

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/upload?pin=' + encodeURIComponent(PIN));

      xhr.upload.onprogress = function(e) {{
        if (e.lengthComputable) {{
          const pct = Math.round((e.loaded / e.total) * 100);
          progressFill.style.width = pct + '%';
          percentText.innerText = pct + '%';
        }}
      }};

      xhr.onload = function() {{
        if (xhr.status === 200) {{
          statusText.innerText = 'Transfer Complete!';
          progressFill.style.background = '#22c55e';
          alert('Successfully transferred ' + selectedFiles.length + ' file(s) to HouShop desktop!');
        }} else {{
          statusText.innerText = 'Upload failed';
          progressFill.style.background = '#ef4444';
        }}
      }};

      xhr.onerror = function() {{
        statusText.innerText = 'Network error during upload';
        progressFill.style.background = '#ef4444';
      }};

      xhr.send(formData);
    }}
  </script>
</body>
</html>"#)
}
