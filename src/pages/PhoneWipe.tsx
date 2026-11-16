import React, { useState, useEffect, useEffectEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Trash2,
  ShieldAlert,
  AlertTriangle,
  Lock,
  Key,
  CheckCircle2,
  Smartphone,
  RefreshCw,
  ExternalLink,
  PlusCircle,
  Clock,
  Search,
  FileCheck2,
  Terminal,
  ChevronRight,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  DeviceInfo,
  PreWipeAuditResult,
  WipeProgressEvent,
  SanitizationRecord,
  ExecuteWipeRequest,
} from '../lib/types';
import { WipeCertificateModal } from '../components/WipeCertificateModal';
import { useI18n } from '../i18n';

const VIRTUAL_DEVICES = [
  { id: 'demo-iphone16-clean', labelKey: 'wipe.demo.iphone16Clean', platform: 'iOS', brand: 'Apple' },
  { id: 'demo-iphone15-locked', labelKey: 'wipe.demo.iphone15Locked', platform: 'iOS', brand: 'Apple' },
  { id: 'demo-s24-frp', labelKey: 'wipe.demo.s24Frp', platform: 'Android', brand: 'Samsung' },
  { id: 'demo-pixel8-clean', labelKey: 'wipe.demo.pixel8Clean', platform: 'Android', brand: 'Google' },
];

export const PhoneWipe: React.FC<{ onNavigate?: (page: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();

  // Split the FMI warning around its bold term so the term can keep its own markup
  const [fmiTextBefore, fmiTextAfter] = t('wipe.critical.text').split('{term}');

  // State
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('demo-pixel8-clean');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('Android');
  const [auditResult, setAuditResult] = useState<PreWipeAuditResult | null>(null);
  const [loadingAudit, setLoadingAudit] = useState<boolean>(false);

  // Airbag & Execution form state
  const [imeiDigitsInput, setImeiDigitsInput] = useState<string>('');
  const [backupConfirmed, setBackupConfirmed] = useState<boolean>(false);
  const [technicianName, setTechnicianName] = useState<string>(() => t('wipe.tech.defaultName'));
  const [selectedWipeMethod, setSelectedWipeMethod] = useState<string>('adb_master_clear');
  const [technicianNotes, setTechnicianNotes] = useState<string>('');
  const [technicianOverride, setTechnicianOverride] = useState<boolean>(false);

  // Live Wiping Console State
  const [isWiping, setIsWiping] = useState<boolean>(false);
  const [wipeProgress, setWipeProgress] = useState<WipeProgressEvent | null>(null);
  const [wipeLogs, setWipeLogs] = useState<string[]>([]);
  const [completedRecord, setCompletedRecord] = useState<SanitizationRecord | null>(null);

  // Certificate Modal State
  const [certificateModalOpen, setCertificateModalOpen] = useState<boolean>(false);
  const [selectedCertificateRecord, setSelectedCertificateRecord] = useState<SanitizationRecord | null>(null);

  // Past Audit Records
  const [pastRecords, setPastRecords] = useState<SanitizationRecord[]>([]);
  const [searchFilter, setSearchFilter] = useState<string>('');

  // 1. Initial Load & Listeners
  useEffect(() => {
    loadConnectedDevices();
    loadPastRecords();

    // Listen for live wipe progress from Rust backend
    let unlistenProgress: (() => void) | null = null;
    listen<WipeProgressEvent>('wipe-progress', (event) => {
      const p = event.payload;
      setWipeProgress(p);
      setWipeLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${p.log_line}`]);
    }).then((u) => {
      unlistenProgress = u;
    });

    // Listen for physical device hotplug
    let unlistenHotplug: (() => void) | null = null;
    listen<DeviceInfo>('physical-device-connected', (event) => {
      onPhysicalDeviceConnected(event.payload.name);
    }).then((u) => {
      unlistenHotplug = u;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenHotplug) unlistenHotplug();
    };
  }, []);

  // 2. Refresh device audit whenever selection changes
  useEffect(() => {
    if (selectedDeviceId) {
      auditSelectedDevice(selectedDeviceId, selectedPlatform);
    }
  }, [selectedDeviceId, selectedPlatform]);

  // Effect events (used only by the effects above): they always see the latest
  // selection and translations, so the effects keep their stable dependency lists
  // and the listeners are not re-attached when those values change.
  const loadConnectedDevices = useEffectEvent(async () => {
    try {
      const devs = await invoke<DeviceInfo[]>('list_transfer_devices');
      setDevices(devs);
      if (devs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(devs[0].id);
        setSelectedPlatform(devs[0].platform);
      }
    } catch (e) {
      console.error('Failed to list devices:', e);
    }
  });

  const loadPastRecords = async () => {
    try {
      const records = await invoke<SanitizationRecord[]>('list_sanitization_records', { limit: 50 });
      setPastRecords(records);
    } catch (e) {
      console.error('Failed to load sanitization records:', e);
    }
  };

  const runDeviceAudit = async (devId: string, platform: string) => {
    setLoadingAudit(true);
    setImeiDigitsInput('');
    setBackupConfirmed(false);
    try {
      const result = await invoke<PreWipeAuditResult>('inspect_device_locks', {
        deviceId: devId,
        platform,
      });
      setAuditResult(result);
      if (result.supported_wipe_methods.length > 0) {
        setSelectedWipeMethod(result.supported_wipe_methods[0].id);
      }
    } catch (e) {
      toast.error(t('wipe.toast.auditError', { error: String(e) }));
    } finally {
      setLoadingAudit(false);
    }
  };

  const onPhysicalDeviceConnected = useEffectEvent((name: string) => {
    toast.info(t('wipe.toast.usbDetected', { name }));
    loadConnectedDevices();
  });

  const auditSelectedDevice = useEffectEvent((devId: string, platform: string) => {
    runDeviceAudit(devId, platform);
  });

  const handleLaunchAccountRemoval = async () => {
    if (!auditResult) return;
    try {
      const res = await invoke<string>('launch_account_removal_screen', {
        deviceId: auditResult.device_id,
        platform: auditResult.platform,
      });
      toast.success(res, { duration: 6000 });
    } catch (e) {
      toast.error(t('wipe.toast.launchFailed', { error: String(e) }));
    }
  };

  // Expected last 4 digits helper
  const getExpectedDigits = () => {
    if (!auditResult) return '1234';
    if (auditResult.imei) {
      const clean = auditResult.imei.replace(/\D/g, '');
      if (clean.length >= 4) return clean.slice(-4);
    }
    if (auditResult.serial_number) {
      const clean = auditResult.serial_number.trim();
      if (clean.length >= 4) return clean.slice(-4);
    }
    return '1234';
  };

  const expectedDigits = getExpectedDigits();
  const digitsMatch = imeiDigitsInput.trim() === expectedDigits;
  const isAirbagPassed = digitsMatch && backupConfirmed && (!auditResult?.blocking_reasons.length || technicianOverride);

  // Trigger NIST 800-88 Cryptographic Wipe
  const handleStartWipe = async () => {
    if (!auditResult || !isAirbagPassed) return;

    setIsWiping(true);
    setWipeLogs([`[${new Date().toLocaleTimeString()}] ${t('wipe.log.init')}`]);
    setWipeProgress({
      step: 1,
      total_steps: 4,
      stage_name: t('wipe.stage.prewipe'),
      progress_percent: 5,
      log_line: t('wipe.log.purgeStart'),
      is_complete: false,
      is_error: false,
    });

    try {
      const req: ExecuteWipeRequest = {
        device_id: auditResult.device_id,
        platform: auditResult.platform,
        wipe_method: selectedWipeMethod,
        technician_name: technicianName,
        technician_override: technicianOverride,
        imei_confirmation_digits: imeiDigitsInput.trim(),
        customer_backup_confirmed: backupConfirmed,
        notes: technicianNotes || null,
      };

      const record = await invoke<SanitizationRecord>('execute_wipe', { req });
      setCompletedRecord(record);
      loadPastRecords();
      toast.success(t('wipe.toast.purged'));
    } catch (e) {
      toast.error(t('wipe.toast.aborted', { error: String(e) }));
      setWipeProgress((prev) =>
        prev
          ? { ...prev, is_error: true, error_message: String(e) }
          : {
              step: 0,
              total_steps: 4,
              stage_name: t('wipe.stage.failed'),
              progress_percent: 0,
              log_line: t('wipe.log.error', { error: String(e) }),
              is_complete: true,
              is_error: true,
              error_message: String(e),
            }
      );
    } finally {
      setIsWiping(false);
    }
  };

  // One-click Add to Inventory
  const handleAddToInventory = (rec: SanitizationRecord) => {
    // The app has no router; navigation goes through the shell. Prefill data is not consumed
    // by the product form yet, so only the destination is handled here.
    void rec;
    onNavigate?.('add-product');
  };

  // Filtered past records
  const filteredRecords = pastRecords.filter((r) => {
    const q = searchFilter.toLowerCase();
    return (
      r.model.toLowerCase().includes(q) ||
      r.certificate_number.toLowerCase().includes(q) ||
      (r.imei && r.imei.includes(q)) ||
      (r.serial_number && r.serial_number.toLowerCase().includes(q))
    );
  });

  const activeStep = completedRecord || isWiping || isAirbagPassed ? 2 : auditResult ? 1 : 0;
  const wizardSteps = [
    { label: t('wipe.steps.audit'), done: !!auditResult, current: activeStep === 0 },
    { label: t('wipe.steps.airbag'), done: isAirbagPassed, current: activeStep === 1 },
    { label: t('wipe.steps.purge'), done: !!completedRecord, current: activeStep === 2 },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-up">
      {/* Page Title & Mission Header */}
      <div className="flex flex-col md:flex-row items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-accent-red/10 flex items-center justify-center shrink-0">
            <Trash2 className="w-6 h-6 text-accent-red" />
          </div>
          <div>
            <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupDevices')}</span>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="page-title">{t('wipe.title')}</h1>
              <span className="badge border border-accent-red/30 bg-accent-red/10 text-accent-red">
                {t('wipe.badge.nist')}
              </span>
            </div>
            <p className="page-subtitle">
              {t('wipe.subtitle')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => runDeviceAudit(selectedDeviceId, selectedPlatform)}
          disabled={loadingAudit}
          className="btn-secondary shrink-0 px-4 py-2 text-[13px]"
        >
          <RefreshCw size={14} className={loadingAudit ? 'animate-spin text-accent-blue' : ''} />
          {t('wipe.reAudit')}
        </button>
      </div>

      {/* Wipe flow progress: clear current state across the three steps */}
      <ol aria-label={t('wipe.progressAria')} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
        {wizardSteps.map((s, i) => (
          <li
            key={s.label}
            aria-current={s.current ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[13px] font-semibold ${
                s.done
                  ? 'bg-accent-green text-white'
                  : s.current
                  ? 'bg-navy text-white'
                  : 'bg-surface border border-border text-text-muted'
              }`}
            >
              {s.done ? <Check size={12} /> : i + 1}
            </span>
            <span className={s.current ? 'font-semibold text-text-primary' : 'text-text-secondary'}>
              {s.label}
            </span>
            {i < wizardSteps.length - 1 && <ChevronRight size={14} className="text-text-muted" />}
          </li>
        ))}
      </ol>

      {/* DEVICE SELECTOR ROW */}
      <div className="card p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Smartphone className="w-5 h-5 text-accent-blue" />
          <span className="text-sm font-medium text-text-primary">{t('wipe.selectPhone')}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Real USB devices */}
          {devices.map((dev) => (
            <button
              type="button"
              key={dev.id}
              aria-pressed={selectedDeviceId === dev.id}
              onClick={() => {
                setSelectedDeviceId(dev.id);
                setSelectedPlatform(dev.platform);
              }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-medium border transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 ${
                selectedDeviceId === dev.id
                  ? 'border-navy bg-navy/10 text-navy'
                  : 'border-border bg-card text-text-secondary hover:bg-surface'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-accent-green" aria-hidden="true"></span>
              <span>{dev.name}</span>
              <span className="text-[13px] text-text-muted font-mono">({dev.platform})</span>
            </button>
          ))}

          {/* Virtual / Demo Devices */}
          {VIRTUAL_DEVICES.map((v) => (
            <button
              type="button"
              key={v.id}
              aria-pressed={selectedDeviceId === v.id}
              onClick={() => {
                setSelectedDeviceId(v.id);
                setSelectedPlatform(v.platform);
              }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-medium border transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 ${
                selectedDeviceId === v.id
                  ? 'border-navy bg-navy/10 text-navy'
                  : 'border-border-light bg-surface text-text-muted hover:bg-card'
              }`}
            >
              <span className="text-[13px] px-1.5 py-0.5 rounded bg-card border border-border-light text-text-muted font-mono">
                {t('wipe.demo.badge')}
              </span>
              <span>{t(v.labelKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* MAIN TWO-COLUMN WIZARD */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Device Identity & Pre-Wipe Lock Audit */}
        <div className="lg:col-span-5 space-y-6">
          {/* Device Profile Card */}
          <div className="card p-6 space-y-5">
            <div className="flex items-center justify-between gap-3 border-b border-border-light pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-accent-blue/10 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-accent-blue" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-text-primary truncate">
                    {auditResult ? auditResult.device_name : t('wipe.auditing')}
                  </h3>
                  <div className="text-[13px] text-text-secondary font-mono truncate">
                    {auditResult ? `${auditResult.brand} • ${auditResult.os_version}` : t('wipe.scanningUsb')}
                  </div>
                </div>
              </div>

              {auditResult?.battery_level != null && (
                <span className="badge border border-border bg-surface text-accent-green font-mono">
                  🔋 {auditResult.battery_level}%
                </span>
              )}
            </div>

            {/* Hardware Identity Spec: key/value list */}
            {auditResult && (
              <dl className="rounded-2xl border border-border-light bg-surface px-4 divide-y divide-border-light">
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[13px] text-text-secondary">{t('wipe.spec.imei')}</dt>
                  <dd className="text-sm font-mono font-medium text-text-primary text-right break-all">
                    {auditResult.imei || t('wipe.naWifi')}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[13px] text-text-secondary">{t('wipe.spec.serial')}</dt>
                  <dd className="text-sm font-mono font-medium text-text-primary text-right break-all">
                    {auditResult.serial_number || t('wipe.na')}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[13px] text-text-secondary">{t('wipe.spec.storage')}</dt>
                  <dd className="text-sm font-medium text-text-primary text-right">
                    {auditResult.storage_capacity || t('wipe.na')}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[13px] text-text-secondary">{t('wipe.spec.platform')}</dt>
                  <dd className="text-sm font-medium text-accent-blue text-right">{auditResult.platform}</dd>
                </div>
              </dl>
            )}

            {/* Dynamic Security Lock Status Gate */}
            {auditResult && (
              <div className="space-y-4 pt-2">
                <h4 className="eyebrow">{t('wipe.audit.eyebrow')}</h4>

                {/* Lock Badge: calm tinted callouts */}
                {auditResult.risk_level === 'critical_blocked' ? (
                  <div className="p-4 rounded-2xl bg-accent-red/10 border border-accent-red/30 space-y-3">
                    <div className="flex items-center gap-2 text-accent-red font-semibold text-sm">
                      <ShieldAlert className="w-5 h-5" />
                      {t('wipe.critical.title')}
                    </div>
                    <p className="text-[13px] text-text-secondary leading-relaxed">
                      {fmiTextBefore}<b className="text-text-primary">{t('wipe.critical.term')}</b>{fmiTextAfter}
                    </p>
                    <button
                      type="button"
                      onClick={handleLaunchAccountRemoval}
                      className="btn-secondary w-full px-4 py-2 text-[13px]"
                    >
                      <ExternalLink size={14} />
                      {t('wipe.critical.signout')}
                    </button>
                  </div>
                ) : auditResult.risk_level === 'warning' ? (
                  <div className="p-4 rounded-2xl bg-accent-orange/10 border border-accent-orange/30 space-y-3">
                    <div className="flex items-center gap-2 text-accent-orange font-semibold text-sm">
                      <AlertTriangle className="w-5 h-5" />
                      {t('wipe.warning.title')}
                    </div>
                    <p className="text-[13px] text-text-secondary leading-relaxed">
                      {t('wipe.warning.text')}
                    </p>
                    <button
                      type="button"
                      onClick={handleLaunchAccountRemoval}
                      className="btn-secondary w-full px-4 py-2 text-[13px]"
                    >
                      <ExternalLink size={14} />
                      {t('wipe.warning.launch')}
                    </button>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-accent-green/10 border border-accent-green/30 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-accent-green shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-text-primary">
                        {t('wipe.safe.title')}
                      </div>
                      <div className="text-[13px] text-text-secondary mt-0.5 leading-relaxed">
                        {t('wipe.safe.text')}
                      </div>
                    </div>
                  </div>
                )}

                {/* Active Accounts Breakdown List */}
                {auditResult.active_accounts.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <span className="text-[13px] font-medium text-text-secondary">
                      {t('wipe.accounts.detected', { count: auditResult.active_accounts.length })}
                    </span>
                    {auditResult.active_accounts.map((acc, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border border-border-light bg-surface flex items-center justify-between gap-3 text-[13px]"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-text-primary truncate">{acc.account_name}</div>
                          <div className="text-[13px] text-text-muted font-mono truncate">{acc.identifier}</div>
                        </div>
                        <span className="badge border border-accent-orange/30 bg-accent-orange/10 text-accent-orange shrink-0">
                          {t('wipe.accounts.mustRemove')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Safety Airbag, Confirmation & Execution Console */}
        <div className="lg:col-span-7 space-y-6">
          {/* Safety Airbag Card */}
          <div className="card p-6 space-y-6">
            <div className="flex items-center gap-3 border-b border-border-light pb-4">
              <div className="w-10 h-10 rounded-2xl bg-accent-orange/10 flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5 text-accent-orange" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">
                  {t('wipe.airbag.title')}
                </h3>
                <p className="text-[13px] text-text-secondary mt-0.5">
                  {t('wipe.airbag.subtitle')}
                </p>
              </div>
            </div>

            {/* 1. Method Selection */}
            {auditResult && (
              <div className="space-y-2.5">
                <label className="text-sm font-medium text-text-primary block">
                  {t('wipe.protocol.label')}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {auditResult.supported_wipe_methods.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => setSelectedWipeMethod(m.id)}
                      aria-pressed={selectedWipeMethod === m.id}
                      className={`text-left p-4 rounded-2xl border transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 ${
                        selectedWipeMethod === m.id
                          ? 'border-navy bg-navy/5 ring-1 ring-navy'
                          : 'border-border bg-card hover:bg-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-semibold text-sm text-text-primary">{m.name}</span>
                        {m.nist_compliant && (
                          <span className="badge whitespace-nowrap shrink-0 bg-accent-green/10 text-accent-green">{t('wipe.method.nistBadge')}</span>
                        )}
                      </div>
                      <span className="block text-[13px] text-text-secondary leading-relaxed line-clamp-2">
                        {m.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Safety 2FA: Typing Last 4 Digits of IMEI */}
            <div className="p-5 rounded-2xl bg-surface border border-border-light space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="wipe-confirm-digits" className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <Key size={14} className="text-accent-orange" />
                  {t('wipe.digits.label')}
                </label>
                <span className="text-[13px] font-mono text-text-secondary">
                  {t('wipe.digits.target')} <b className="text-text-primary tracking-widest">{expectedDigits}</b>
                </span>
              </div>

              <div className="relative">
                <input
                  id="wipe-confirm-digits"
                  type="text"
                  maxLength={4}
                  placeholder={t('wipe.digits.placeholder', { digits: expectedDigits })}
                  value={imeiDigitsInput}
                  onChange={(e) => setImeiDigitsInput(e.target.value.trim())}
                  className={`form-input py-3 text-center font-mono text-lg font-semibold tracking-widest ${
                    digitsMatch
                      ? 'border-accent-green text-accent-green focus:border-accent-green focus:ring-accent-green/20'
                      : imeiDigitsInput.length > 0
                      ? 'border-accent-red text-accent-red focus:border-accent-red focus:ring-accent-red/20'
                      : ''
                  }`}
                />
                {digitsMatch && (
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-accent-green pointer-events-none">
                    <CheckCircle2 size={18} />
                  </div>
                )}
              </div>
            </div>

            {/* 3. Customer Backup Checkbox */}
            <label className="flex items-start gap-3 p-4 rounded-2xl border border-border-light bg-card hover:bg-surface cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={backupConfirmed}
                onChange={(e) => setBackupConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-navy"
              />
              <span className="text-[13px] text-text-secondary leading-relaxed">
                <b className="text-text-primary">{t('wipe.handover.label')}</b> {t('wipe.handover.text')}
              </span>
            </label>

            {/* Technician Name & Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="wipe-technician-name" className="text-[13px] font-medium text-text-secondary block">
                  {t('wipe.tech.name')}
                </label>
                <input
                  id="wipe-technician-name"
                  type="text"
                  value={technicianName}
                  onChange={(e) => setTechnicianName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="wipe-technician-note" className="text-[13px] font-medium text-text-secondary block">
                  {t('wipe.tech.note')}
                </label>
                <input
                  id="wipe-technician-note"
                  type="text"
                  placeholder={t('wipe.tech.notePlaceholder')}
                  value={technicianNotes}
                  onChange={(e) => setTechnicianNotes(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {/* Emergency Technician Override Checkbox for blocked devices */}
            {auditResult?.risk_level === 'critical_blocked' && (
              <label className="flex items-start gap-3 p-4 rounded-2xl bg-accent-red/10 border border-accent-red/30 text-[13px] text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={technicianOverride}
                  onChange={(e) => setTechnicianOverride(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-navy"
                />
                <span className="font-semibold leading-relaxed">
                  {t('wipe.override.label')}
                </span>
              </label>
            )}

            {/* THE WIPE EXECUTE BUTTON (gated by the airbag above) */}
            <button
              type="button"
              onClick={handleStartWipe}
              disabled={!isAirbagPassed || isWiping}
              className="btn-danger w-full py-3.5 text-sm font-semibold"
            >
              <Trash2 size={18} />
              {isWiping ? t('wipe.execute.busy') : t('wipe.execute.start')}
            </button>
          </div>

          {/* LIVE WIPING CONSOLE (Visible during and after wipe) */}
          {(isWiping || wipeProgress || completedRecord) && (
            <div className="card p-6 space-y-5 animate-fade-up">
              <div className="flex items-center justify-between border-b border-border-light pb-4">
                <div className="flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-accent-green" />
                  <h3 className="text-sm font-semibold text-text-primary">{t('wipe.console.title')}</h3>
                </div>
                {wipeProgress && (
                  <span className="text-[13px] font-mono font-semibold text-text-primary">
                    {wipeProgress.progress_percent}%
                  </span>
                )}
              </div>

              {/* Progress Bar: slim rounded track with navy fill */}
              {wipeProgress && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="font-medium text-text-primary">{wipeProgress.stage_name}</span>
                    <span className="text-text-muted">
                      {t('wipe.progress.step', { step: wipeProgress.step, total: wipeProgress.total_steps })}
                    </span>
                  </div>
                  <div
                    className="w-full h-2 rounded-full bg-border-light overflow-hidden"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={wipeProgress.progress_percent}
                    aria-label={t('wipe.progressAria')}
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        wipeProgress.is_error
                          ? 'bg-accent-red'
                          : wipeProgress.is_complete
                          ? 'bg-accent-green'
                          : 'bg-navy'
                      }`}
                      style={{ width: `${wipeProgress.progress_percent}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* Log Window */}
              <div
                role="log"
                aria-live="polite"
                className="p-4 rounded-xl bg-surface border border-border-light font-mono text-[13px] text-text-secondary h-36 overflow-y-auto space-y-1 select-text"
              >
                {wipeLogs.map((log, i) => (
                  <div key={i} className="leading-relaxed">
                    {log}
                  </div>
                ))}
              </div>

              {/* Success Action Bar upon Completion */}
              {completedRecord && (
                <div className="pt-4 border-t border-border-light flex flex-wrap items-center justify-between gap-3 animate-fade-up">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-accent-green">
                    <CheckCircle2 size={16} />
                    <span>{t('wipe.success')}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCertificateRecord(completedRecord);
                        setCertificateModalOpen(true);
                      }}
                      className="btn-primary px-4 py-2 text-[13px]"
                    >
                      <FileCheck2 size={14} />
                      {t('wipe.action.viewCert')}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleAddToInventory(completedRecord)}
                      className="btn-secondary px-4 py-2 text-[13px]"
                    >
                      <PlusCircle size={14} className="text-accent-blue" />
                      {t('wipe.action.addInventory')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* PAST SANITIZATION AUDIT TRAIL TABLE */}
      <div className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border-light pb-4">
          <div>
            <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Clock className="w-5 h-5 text-accent-blue" />
              {t('wipe.records.title')}
            </h3>
            <p className="text-[13px] text-text-secondary mt-1">
              {t('wipe.records.subtitle')}
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              aria-label={t('wipe.records.searchAria')}
              placeholder={t('wipe.records.searchPlaceholder')}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="form-input py-2 pl-9"
            />
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <div className="py-12 text-center text-sm text-text-muted">
            {t('wipe.records.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border-light">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface text-text-secondary">
                <tr className="border-b border-border-light">
                  <th scope="col" className="py-3 px-4 font-medium">{t('wipe.table.certNo')}</th>
                  <th scope="col" className="py-3 px-4 font-medium">{t('wipe.table.model')}</th>
                  <th scope="col" className="py-3 px-4 font-medium">{t('wipe.table.imeiSerial')}</th>
                  <th scope="col" className="py-3 px-4 font-medium">{t('wipe.table.method')}</th>
                  <th scope="col" className="py-3 px-4 font-medium">{t('wipe.table.technician')}</th>
                  <th scope="col" className="py-3 px-4 font-medium">{t('common.date')}</th>
                  <th scope="col" className="py-3 px-4 font-medium text-right">{t('wipe.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light text-text-secondary">
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-surface transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-accent-green whitespace-nowrap">
                      {rec.certificate_number}
                    </td>
                    <td className="py-3 px-4 font-medium text-text-primary whitespace-nowrap">
                      {rec.brand} {rec.model}
                    </td>
                    <td className="py-3 px-4 font-mono text-[13px] text-text-muted">
                      {rec.imei || rec.serial_number || t('wipe.na')}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex rounded-md px-2 py-0.5 text-[13px] font-medium bg-surface border border-border text-text-secondary">
                        {rec.wipe_method}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-text-primary">{rec.technician_name}</td>
                    <td className="py-3 px-4 text-text-muted whitespace-nowrap">
                      {new Date(rec.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCertificateRecord(rec);
                          setCertificateModalOpen(true);
                        }}
                        className="btn-secondary px-3 py-1.5 text-[13px]"
                      >
                        <FileCheck2 size={13} className="text-accent-green" />
                        {t('wipe.table.certButton')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* NIST 800-88 A4 CERTIFICATE MODAL */}
      <WipeCertificateModal
        isOpen={certificateModalOpen}
        onClose={() => setCertificateModalOpen(false)}
        record={selectedCertificateRecord}
      />
    </div>
  );
};
export default PhoneWipe;
