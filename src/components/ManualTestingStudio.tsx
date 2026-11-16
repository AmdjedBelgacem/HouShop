import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Volume2,
  Mic,
  Camera,
  Play,
  CheckCircle2,
  XCircle,
  X,
  Radio,
  Zap,
  Sparkles,
  Smartphone,
  QrCode,
  Grid,
  Palette,
  ShieldCheck,
} from 'lucide-react';
import type { DiagnosticServerInfo, HardwareTestResult } from '../lib/types';
import { toast } from 'sonner';
import { useI18n } from '../i18n';

// Renders **bold** segments of a translated string as <b> elements.
function renderRich(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part));
}

interface ManualTestingStudioProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId: string;
  deviceName: string;
  platform: string;
  hardwareTests: Record<string, HardwareTestResult>;
  onUpdateTest: (key: string, passed: boolean, details?: string) => void;
}

type TabType = 'sound' | 'mic' | 'vibrate' | 'camera' | 'screen';

export const ManualTestingStudio: React.FC<ManualTestingStudioProps> = ({
  isOpen,
  onClose,
  deviceId,
  deviceName,
  platform,
  hardwareTests,
  onUpdateTest,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('sound');
  const [serverInfo, setServerInfo] = useState<DiagnosticServerInfo | null>(null);
  const [phoneConnected, setPhoneConnected] = useState<boolean>(false);
  const [activeActionLabel, setActiveActionLabel] = useState<string | null>(null);
  const [showQrDetails, setShowQrDetails] = useState<boolean>(false);
  const { t } = useI18n();
  // The companion listeners are registered once per open, so read the translator through a ref.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Initialize companion server and listeners
  useEffect(() => {
    if (!isOpen) return;

    let unlistenSync: (() => void) | null = null;
    let unlistenConnect: (() => void) | null = null;
    let unlistenDisconnect: (() => void) | null = null;

    // Start or query companion server
    invoke<DiagnosticServerInfo>('start_diagnostic_server')
      .then((info) => {
        setServerInfo(info);
      })
      .catch((err) => {
        console.error('Failed to start diagnostic server:', err);
      });

    // Listen for phone connection events
    listen('mobile-companion-connected', () => {
      setPhoneConnected(true);
      toast.success(tRef.current('manual.toast.synced'));
    }).then((u) => {
      unlistenConnect = u;
    });

    listen('mobile-companion-disconnected', () => {
      setPhoneConnected(false);
    }).then((u) => {
      unlistenDisconnect = u;
    });

    // Clear the "executing on phone" pill when the phone reports a result.
    // The report mutation itself is handled by the Diagnostics page so grading
    // is recomputed exactly once per phone result.
    listen('diagnostic-test-synced', () => {
      setActiveActionLabel(null);
    }).then((u) => {
      unlistenSync = u;
    });

    return () => {
      if (unlistenSync) unlistenSync();
      if (unlistenConnect) unlistenConnect();
      if (unlistenDisconnect) unlistenDisconnect();
    };
  }, [isOpen]);

  // Dispatch a command to be executed ON THE PHONE
  const sendPhoneCommand = async (action: string, params?: unknown, actionLabel?: string) => {
    // The command is queued regardless — warn so the technician knows the phone
    // must be paired via QR for anything to actually happen on it.
    if (!phoneConnected) {
      toast.warning(t('manual.toast.noPhone'));
    }
    try {
      if (actionLabel) setActiveActionLabel(actionLabel);
      await invoke('send_mobile_diagnostic_command', {
        action,
        params: params || null,
      });

      // Clear action label after a timeout
      setTimeout(() => {
        setActiveActionLabel(null);
      }, 3500);
    } catch (e) {
      console.error('Command failed:', e);
      toast.error(t('manual.toast.sendFailed', { error: String(e) }));
      setActiveActionLabel(null);
    }
  };

  // Launch companion app directly on Android via ADB
  const handleLaunchAndroid = async () => {
    if (!serverInfo) return;
    try {
      const res = await invoke<string>('launch_mobile_companion_on_device', {
        deviceId,
        platform,
        connectUrl: serverInfo.connect_url,
      });
      toast.success(res);
    } catch (e) {
      toast.error(t('manual.toast.adbFailed', { error: String(e) }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-card border border-border rounded-2xl shadow-raised overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-navy flex items-center justify-center shadow-lg">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text-primary">
                  {t('manual.title')}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[13px] font-bold bg-accent-blue/20 text-accent-blue border border-accent-blue/30">
                  {t('manual.target', { name: deviceName })}
                </span>
              </div>
              <p className="text-[13px] text-text-muted">
                {renderRich(t('manual.subtitle'))}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="btn-ghost h-8 w-8 p-0 rounded-lg"
          >
            <X size={16} />
          </button>
        </div>

        {/* Live Phone Pairing & Companion Status Banner */}
        <div className="px-6 py-3 bg-surface/70 border-b border-border flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  phoneConnected ? 'bg-accent-green' : 'bg-accent-orange'
                }`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  phoneConnected ? 'bg-accent-green' : 'bg-accent-orange'
                }`}
              ></span>
            </span>

            {phoneConnected ? (
              <span className="font-bold text-accent-green flex items-center gap-1.5">
                <ShieldCheck size={14} /> {t('manual.companion.synced')}
              </span>
            ) : (
              <div className="text-text-secondary">
                {renderRich(t('manual.companion.pairing'))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {platform.toLowerCase() === 'android' && (
              <button
                onClick={handleLaunchAndroid}
                className="px-3 py-1 bg-accent-green/20 hover:bg-accent-green/30 text-accent-green border border-accent-green/40 rounded-lg text-[13px] font-bold transition-colors"
              >
                {t('manual.autoOpen')}
              </button>
            )}

            <button
              onClick={() => setShowQrDetails(!showQrDetails)}
              className="flex items-center gap-1.5 px-3 py-1 bg-surface hover:bg-border-light text-text-primary border border-border rounded-lg text-[13px] font-semibold transition-colors"
            >
              <QrCode size={13} className="text-accent-blue" />
              {showQrDetails ? t('manual.hideQr') : t('manual.showQr')}
            </button>
          </div>
        </div>

        {/* Collapsible Dynamic QR Code Panel */}
        {showQrDetails && serverInfo && (
          <div className="p-4 bg-surface/90 border-b border-border flex flex-col sm:flex-row items-center gap-5 animate-in fade-in duration-150">
            <div className="p-2 bg-white rounded-2xl shadow-xl flex-shrink-0">
              <img
                src={serverInfo.qr_code_data_url}
                alt={t('manual.qrAlt')}
                className="w-36 h-36"
              />
            </div>
            <div className="space-y-2 text-[13px] text-text-secondary max-w-lg">
              <h4 className="font-bold text-text-primary text-sm">
                {t('manual.qr.title')}
              </h4>
              <p>
                {renderRich(t('manual.qr.step1', { device: deviceName }))}
              </p>
              <p>
                {renderRich(t('manual.qr.step2'))}
              </p>
              <p>
                {t('manual.qr.step3')}
              </p>
              <div className="pt-1 font-mono text-[13px] text-accent-blue">
                {t('manual.qr.directUrl', { url: serverInfo.connect_url })}
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-border bg-surface/40 px-6 pt-2 overflow-x-auto">
          {[
            { id: 'sound', label: t('manual.tab.sound'), icon: Volume2 },
            { id: 'mic', label: t('manual.tab.mic'), icon: Mic },
            { id: 'vibrate', label: t('manual.tab.vibrate'), icon: Radio },
            { id: 'camera', label: t('manual.tab.camera'), icon: Camera },
            { id: 'screen', label: t('manual.tab.screen'), icon: Grid },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 px-4 py-3 text-[13px] font-bold border-b-2 whitespace-nowrap transition-all ${
                  active
                    ? 'border-navy text-navy'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Action Status Notification Pill */}
        {activeActionLabel && (
          <div className="bg-accent-blue/15 border-b border-accent-blue/30 px-6 py-2 text-[13px] text-accent-blue flex items-center justify-between animate-pulse">
            <span className="font-bold flex items-center gap-2">
              <Zap size={13} className="text-accent-orange" />
              {activeActionLabel}
            </span>
            <span className="text-[13px] text-text-muted">{t('manual.executing', { device: deviceName })}</span>
          </div>
        )}

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: PHONE SOUND & SPEAKERS */}
          {activeTab === 'sound' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Station 1: Earpiece / Receiver */}
                <div className="p-5 rounded-2xl bg-surface/40 border border-border flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-5 h-5 text-accent-blue" />
                        <h3 className="text-sm font-bold text-text-primary">{t('manual.sound.earpiece.title')}</h3>
                      </div>
                      <span className="text-[13px] font-mono text-text-muted">{t('manual.sound.earpiece.badge')}</span>
                    </div>
                    <p className="text-[13px] text-text-secondary leading-relaxed">
                      {renderRich(t('manual.sound.earpiece.desc'))}
                    </p>
                  </div>

                  <div className="pt-2 flex flex-col gap-3">
                    <button
                      onClick={() =>
                        sendPhoneCommand(
                          'play_tone',
                          { freq: 440, key: 'earpiece_speaker' },
                          t('manual.sound.earpiece.emitting')
                        )
                      }
                      className="flex items-center justify-center gap-2 py-3 px-4 bg-navy hover:bg-navy-light text-white rounded-xl text-[13px] font-bold shadow-md transition-all active:scale-[0.98]"
                    >
                      <Play size={14} />
                      {t('manual.sound.earpiece.play')}
                    </button>

                    <div className="flex items-center justify-between pt-2 border-t border-border-light">
                      <span className="text-[13px] text-text-muted">{t('manual.markResult')}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            onUpdateTest(
                              'earpiece_speaker',
                              true,
                              t('manual.detail.earpiecePass')
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                            hardwareTests['earpiece_speaker']?.passed
                              ? 'bg-accent-green text-white font-bold'
                              : 'bg-accent-green/20 text-accent-green hover:bg-accent-green/30'
                          }`}
                        >
                          <CheckCircle2 size={13} /> {t('manual.passed')}
                        </button>
                        <button
                          onClick={() =>
                            onUpdateTest(
                              'earpiece_speaker',
                              false,
                              t('manual.detail.earpieceFail')
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                            hardwareTests['earpiece_speaker']?.tested && !hardwareTests['earpiece_speaker'].passed
                              ? 'bg-accent-red text-white font-bold'
                              : 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30'
                          }`}
                        >
                          <XCircle size={13} /> {t('transfer.statusFailed')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Station 2: Bottom Stereo Loudspeaker */}
                <div className="p-5 rounded-2xl bg-surface/40 border border-border flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-5 h-5 text-accent-blue" />
                        <h3 className="text-sm font-bold text-text-primary">{t('manual.sound.bottom.title')}</h3>
                      </div>
                      <span className="text-[13px] font-mono text-text-muted">{t('manual.sound.bottom.badge')}</span>
                    </div>
                    <p className="text-[13px] text-text-secondary leading-relaxed">
                      {renderRich(t('manual.sound.bottom.desc'))}
                    </p>
                  </div>

                  <div className="pt-2 flex flex-col gap-3">
                    <button
                      onClick={() =>
                        sendPhoneCommand(
                          'play_tone',
                          { freq: 1000, key: 'bottom_loudspeaker' },
                          t('manual.sound.bottom.emitting')
                        )
                      }
                      className="flex items-center justify-center gap-2 py-3 px-4 bg-navy hover:bg-navy-light text-white rounded-xl text-[13px] font-bold shadow-md transition-all active:scale-[0.98]"
                    >
                      <Play size={14} />
                      {t('manual.sound.bottom.play')}
                    </button>

                    <div className="flex items-center justify-between pt-2 border-t border-border-light">
                      <span className="text-[13px] text-text-muted">{t('manual.markResult')}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            onUpdateTest(
                              'bottom_loudspeaker',
                              true,
                              t('manual.detail.bottomPass')
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                            hardwareTests['bottom_loudspeaker']?.passed
                              ? 'bg-accent-green text-white font-bold'
                              : 'bg-accent-green/20 text-accent-green hover:bg-accent-green/30'
                          }`}
                        >
                          <CheckCircle2 size={13} /> {t('manual.passed')}
                        </button>
                        <button
                          onClick={() =>
                            onUpdateTest(
                              'bottom_loudspeaker',
                              false,
                              t('manual.detail.bottomFail')
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                            hardwareTests['bottom_loudspeaker']?.tested && !hardwareTests['bottom_loudspeaker'].passed
                              ? 'bg-accent-red text-white font-bold'
                              : 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30'
                          }`}
                        >
                          <XCircle size={13} /> {t('transfer.statusFailed')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PHONE MICROPHONE & RECORDING LOOPBACK */}
          {activeTab === 'mic' && (
            <div className="space-y-4">
              <div className="p-6 rounded-2xl bg-surface/40 border border-border space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mic className="w-5 h-5 text-accent-green" />
                    <h3 className="text-sm font-bold text-text-primary">{t('manual.mic.title')}</h3>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[13px] font-bold bg-accent-green/20 text-accent-green border border-accent-green/30">
                    {t('manual.mic.badge')}
                  </span>
                </div>

                <p className="text-[13px] text-text-secondary leading-relaxed">
                  {renderRich(t('manual.mic.desc'))}
                </p>

                <div className="pt-2">
                  <button
                    onClick={() =>
                      sendPhoneCommand(
                        'record_mic',
                        { duration: 3 },
                        t('manual.mic.emitting')
                      )
                    }
                    className="flex items-center justify-center gap-2 w-full py-3.5 bg-accent-green hover:brightness-110 text-white rounded-xl text-[13px] font-bold shadow-md transition-all active:scale-[0.98]"
                  >
                    <Mic size={15} />
                    {t('manual.mic.trigger')}
                  </button>
                </div>

                {/* Verification Checkboxes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4 border-t border-border-light">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-card/60 border border-border">
                    <div>
                      <div className="text-[13px] font-bold text-text-primary">{t('manual.mic.main')}</div>
                      <div className="text-[13px] text-text-muted">{t('manual.mic.mainHint')}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() =>
                          onUpdateTest('main_microphone', true, t('manual.detail.mainPass'))
                        }
                        className={`px-2.5 py-1 rounded text-[13px] font-bold ${
                          hardwareTests['main_microphone']?.passed
                            ? 'bg-accent-green text-white font-bold'
                            : 'bg-surface text-text-muted hover:bg-accent-green/20 hover:text-accent-green'
                        }`}
                      >
                        {t('diagnostics.pass')}
                      </button>
                      <button
                        onClick={() =>
                          onUpdateTest('main_microphone', false, t('manual.detail.mainFail'))
                        }
                        className={`px-2.5 py-1 rounded text-[13px] font-bold ${
                          hardwareTests['main_microphone']?.tested && !hardwareTests['main_microphone'].passed
                            ? 'bg-accent-red text-white font-bold'
                            : 'bg-surface text-text-muted hover:bg-accent-red/20 hover:text-accent-red'
                        }`}
                      >
                        {t('diagnostics.fail')}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-card/60 border border-border">
                    <div>
                      <div className="text-[13px] font-bold text-text-primary">{t('manual.mic.noise')}</div>
                      <div className="text-[13px] text-text-muted">{t('manual.mic.noiseHint')}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() =>
                          onUpdateTest('noise_mic', true, t('manual.detail.noisePass'))
                        }
                        className={`px-2.5 py-1 rounded text-[13px] font-bold ${
                          hardwareTests['noise_mic']?.passed
                            ? 'bg-accent-green text-white font-bold'
                            : 'bg-surface text-text-muted hover:bg-accent-green/20 hover:text-accent-green'
                        }`}
                      >
                        {t('diagnostics.pass')}
                      </button>
                      <button
                        onClick={() =>
                          onUpdateTest('noise_mic', false, t('manual.detail.noiseFail'))
                        }
                        className={`px-2.5 py-1 rounded text-[13px] font-bold ${
                          hardwareTests['noise_mic']?.tested && !hardwareTests['noise_mic'].passed
                            ? 'bg-accent-red text-white font-bold'
                            : 'bg-surface text-text-muted hover:bg-accent-red/20 hover:text-accent-red'
                        }`}
                      >
                        {t('diagnostics.fail')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PHONE VIBRATION & HAPTICS */}
          {activeTab === 'vibrate' && (
            <div className="space-y-4">
              <div className="p-6 rounded-2xl bg-surface/40 border border-border space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-5 h-5 text-accent-blue" />
                    <h3 className="text-sm font-bold text-text-primary">{t('manual.vibrate.title')}</h3>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[13px] font-bold bg-accent-blue/20 text-accent-blue border border-accent-blue/30">
                    {t('manual.vibrate.badge')}
                  </span>
                </div>

                <p className="text-[13px] text-text-secondary leading-relaxed">
                  {renderRich(t('manual.vibrate.desc'))}
                </p>

                <div className="pt-2">
                  <button
                    onClick={() =>
                      sendPhoneCommand(
                        'vibrate',
                        null,
                        t('manual.vibrate.emitting')
                      )
                    }
                    className="flex items-center justify-center gap-2 w-full py-3.5 bg-navy hover:bg-navy-light text-white rounded-xl text-[13px] font-bold shadow-md transition-all active:scale-[0.98]"
                  >
                    <Radio size={15} />
                    {t('manual.vibrate.trigger')}
                  </button>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border-light">
                  <span className="text-[13px] text-text-muted">{t('manual.vibrate.result')}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        onUpdateTest('force_touch', true, t('manual.detail.hapticPass'))
                      }
                      className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                        hardwareTests['force_touch']?.passed
                          ? 'bg-accent-green text-white font-bold'
                          : 'bg-accent-green/20 text-accent-green hover:bg-accent-green/30'
                      }`}
                    >
                      <CheckCircle2 size={13} /> {t('manual.passed')}
                    </button>
                    <button
                      onClick={() =>
                        onUpdateTest('force_touch', false, t('manual.detail.hapticFail'))
                      }
                      className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                        hardwareTests['force_touch']?.tested && !hardwareTests['force_touch'].passed
                          ? 'bg-accent-red text-white font-bold'
                          : 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30'
                      }`}
                    >
                      <XCircle size={13} /> {t('transfer.statusFailed')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PHONE CAMERAS & OPTICS */}
          {activeTab === 'camera' && (
            <div className="space-y-4">
              <div className="p-6 rounded-2xl bg-surface/40 border border-border space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Camera className="w-5 h-5 text-accent-blue" />
                    <h3 className="text-sm font-bold text-text-primary">{t('manual.camera.title')}</h3>
                  </div>
                  <span className="text-[13px] text-text-muted">{t('manual.camera.badge')}</span>
                </div>

                <p className="text-[13px] text-text-secondary leading-relaxed">
                  {renderRich(t('manual.camera.desc'))}
                </p>

                {/* Remote Trigger Buttons for Phone Cameras */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  <button
                    onClick={() =>
                      sendPhoneCommand(
                        'start_camera',
                        { facing: 'environment', key: 'camera_rear_wide' },
                        t('manual.camera.rearEmitting')
                      )
                    }
                    className="p-3 bg-surface hover:bg-border-light text-text-primary border border-border rounded-xl text-[13px] font-bold transition-all text-center flex items-center justify-center gap-2"
                  >
                    <Camera size={14} className="text-accent-blue" />
                    {t('manual.camera.openRear')}
                  </button>
                  <button
                    onClick={() =>
                      sendPhoneCommand(
                        'start_camera',
                        { facing: 'user', key: 'camera_front' },
                        t('manual.camera.frontEmitting')
                      )
                    }
                    className="p-3 bg-surface hover:bg-border-light text-text-primary border border-border rounded-xl text-[13px] font-bold transition-all text-center flex items-center justify-center gap-2"
                  >
                    <Camera size={14} className="text-accent-blue" />
                    {t('manual.camera.openFront')}
                  </button>
                  <button
                    onClick={() =>
                      sendPhoneCommand('toggle_torch', null, t('manual.camera.torchEmitting'))
                    }
                    className="p-3 bg-accent-orange/20 hover:bg-accent-orange/30 text-accent-orange border border-accent-orange/40 rounded-xl text-[13px] font-bold transition-all text-center flex items-center justify-center gap-2"
                  >
                    <Zap size={14} />
                    {t('manual.camera.torch')}
                  </button>
                </div>

                {/* Checklist for Optical Lenses */}
                <div className="pt-4 border-t border-border-light space-y-2.5">
                  <h4 className="text-[13px] font-bold text-text-muted mb-2">
                    {t('manual.camera.checklist')}
                  </h4>

                  {[
                    { key: 'camera_rear_wide', name: t('manual.cam.rearWide.name'), details: t('manual.cam.rearWide.details') },
                    { key: 'camera_rear_ultra', name: t('manual.cam.ultra.name'), details: t('manual.cam.ultra.details') },
                    { key: 'camera_rear_tele', name: t('manual.cam.tele.name'), details: t('manual.cam.tele.details') },
                    { key: 'camera_front', name: t('manual.cam.front.name'), details: t('manual.cam.front.details') },
                    { key: 'camera_flash_torch', name: t('manual.cam.flash.name'), details: t('manual.cam.flash.details') },
                  ].map((cam) => {
                    const testItem = hardwareTests[cam.key];
                    const passed = testItem?.passed;
                    return (
                      <div
                        key={cam.key}
                        className="p-3 rounded-xl bg-card/60 border border-border flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-text-primary truncate">{cam.name}</div>
                          <div className="text-[13px] text-text-muted truncate">{cam.details}</div>
                        </div>

                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => onUpdateTest(cam.key, true, cam.details)}
                            className={`px-2.5 py-1 rounded text-[13px] font-bold transition-colors ${
                              passed
                                ? 'bg-accent-green text-white font-bold'
                                : 'bg-surface text-text-muted hover:bg-accent-green/20 hover:text-accent-green'
                            }`}
                          >
                            {t('diagnostics.pass')}
                          </button>
                          <button
                            onClick={() => onUpdateTest(cam.key, false, t('manual.detail.lensFail', { name: cam.name }))}
                            className={`px-2.5 py-1 rounded text-[13px] font-bold transition-colors ${
                              testItem?.tested && !testItem.passed
                                ? 'bg-accent-red text-white font-bold'
                                : 'bg-surface text-text-muted hover:bg-accent-red/20 hover:text-accent-red'
                            }`}
                          >
                            {t('diagnostics.fail')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: PHONE SCREEN, TOUCH DIGITIZER & RGBW PANELS */}
          {activeTab === 'screen' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 120-Cell Touch Matrix */}
                <div className="p-5 rounded-2xl bg-surface/40 border border-border flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Grid className="w-5 h-5 text-accent-green" />
                      <h3 className="text-sm font-bold text-text-primary">{t('manual.screen.touch.title')}</h3>
                    </div>
                    <p className="text-[13px] text-text-secondary leading-relaxed">
                      {renderRich(t('manual.screen.touch.desc'))}
                    </p>
                  </div>

                  <div className="pt-2 flex flex-col gap-3">
                    <button
                      onClick={() =>
                        sendPhoneCommand(
                          'start_touch',
                          null,
                          t('manual.screen.touch.emitting')
                        )
                      }
                      className="py-3 px-4 bg-accent-green hover:brightness-110 text-white rounded-xl text-[13px] font-bold shadow-md transition-all active:scale-[0.98] text-center"
                    >
                      {t('manual.screen.touch.launch')}
                    </button>

                    <div className="flex items-center justify-between pt-2 border-t border-border-light">
                      <span className="text-[13px] text-text-muted">{t('manual.screen.touch.status')}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            onUpdateTest(
                              'touch_matrix',
                              true,
                              t('manual.detail.touchPass')
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                            hardwareTests['touch_matrix']?.passed
                              ? 'bg-accent-green text-white font-bold'
                              : 'bg-accent-green/20 text-accent-green hover:bg-accent-green/30'
                          }`}
                        >
                          <CheckCircle2 size={13} /> {t('manual.passed')}
                        </button>
                        <button
                          onClick={() =>
                            onUpdateTest(
                              'touch_matrix',
                              false,
                              t('manual.detail.touchFail')
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                            hardwareTests['touch_matrix']?.tested && !hardwareTests['touch_matrix'].passed
                              ? 'bg-accent-red text-white font-bold'
                              : 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30'
                          }`}
                        >
                          <XCircle size={13} /> {t('transfer.statusFailed')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Display Panels RGBW */}
                <div className="p-5 rounded-2xl bg-surface/40 border border-border flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Palette className="w-5 h-5 text-accent-blue" />
                      <h3 className="text-sm font-bold text-text-primary">{t('manual.screen.rgbw.title')}</h3>
                    </div>
                    <p className="text-[13px] text-text-secondary leading-relaxed">
                      {renderRich(t('manual.screen.rgbw.desc'))}
                    </p>
                  </div>

                  <div className="pt-2 flex flex-col gap-3">
                    <button
                      onClick={() =>
                        sendPhoneCommand(
                          'start_rgbw',
                          null,
                          t('manual.screen.rgbw.emitting')
                        )
                      }
                      className="py-3 px-4 bg-navy hover:bg-navy-light text-white rounded-xl text-[13px] font-bold shadow-md transition-all active:scale-[0.98] text-center"
                    >
                      {t('manual.screen.rgbw.launch')}
                    </button>

                    <div className="flex items-center justify-between pt-2 border-t border-border-light">
                      <span className="text-[13px] text-text-muted">{t('manual.screen.rgbw.status')}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            onUpdateTest(
                              'display_rgbw',
                              true,
                              t('manual.detail.rgbwPass')
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                            hardwareTests['display_rgbw']?.passed
                              ? 'bg-accent-green text-white font-bold'
                              : 'bg-accent-green/20 text-accent-green hover:bg-accent-green/30'
                          }`}
                        >
                          <CheckCircle2 size={13} /> {t('manual.passed')}
                        </button>
                        <button
                          onClick={() =>
                            onUpdateTest(
                              'display_rgbw',
                              false,
                              t('manual.detail.rgbwFail')
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-colors ${
                            hardwareTests['display_rgbw']?.tested && !hardwareTests['display_rgbw'].passed
                              ? 'bg-accent-red text-white font-bold'
                              : 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30'
                          }`}
                        >
                          <XCircle size={13} /> {t('transfer.statusFailed')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-surface/70">
          <div className="text-[13px] text-text-muted flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent-blue" />
            <span>{t('manual.footer')}</span>
          </div>
          <button
            onClick={onClose}
            className="btn-primary text-[13px] py-2 px-5"
          >
            {t('manual.done')}
          </button>
        </div>
      </div>
    </div>
  );
};
