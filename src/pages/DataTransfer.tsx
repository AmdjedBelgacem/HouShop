import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import { useBranding } from '../hooks/brandingContext';
import ConfirmDialog from '../components/ConfirmDialog';
import PhoneMockup from '../components/PhoneMockup';
import TransferDataBridge from '../components/TransferDataBridge';
import type {
  DeviceInfo,
  DeviceDataSummary,
  TransferCategory,
  TransferProgressEvent,
  TransferSummaryReport,
  TransferLogRecord,
  TransferSessionRecord,
  WifiServerInfo,
} from '../lib/types';
import {
  Smartphone,
  RotateCw,
  Wifi,
  AlertTriangle,
  XCircle,
  X,
  Printer,
  ShieldCheck,
  Users,
  MessageSquare,
  PhoneCall,
  Calendar,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  Check,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from 'lucide-react';

type TransferStep = 'connect' | 'categories' | 'transferring' | 'completed';

const CATEGORY_ICONS: Record<TransferCategory, React.ReactNode> = {
  contacts: <Users size={20} className="text-accent-blue" />,
  messages: <MessageSquare size={20} className="text-accent-green" />,
  calls: <PhoneCall size={20} className="text-accent-blue" />,
  calendars: <Calendar size={20} className="text-purple-500" />,
  photos: <ImageIcon size={20} className="text-accent-orange" />,
  videos: <Video size={20} className="text-accent-red" />,
  audio: <Music size={20} className="text-cyan-500" />,
  documents: <FileText size={20} className="text-accent-orange" />,
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Message for a rejected Tauri call or mutation: the `message` of an Error or
// object, otherwise String(e). Same text as the previous `e?.message || String(e)`.
function errorMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e && e.message) {
    return String(e.message);
  }
  return String(e);
}

// Priority auto-selection: real physical devices win over demo devices when a
// slot is empty, but explicit user choices (including swaps) are never
// silently overridden. Stale selections (device unplugged / demos disabled)
// are cleared so a transfer can never start against a missing device.
function resolveDeviceSelection(
  devices: DeviceInfo[],
  physicalDevices: DeviceInfo[],
  sourceId: string,
  targetId: string,
): { source: string; target: string } {
  let source = devices.some((d) => d.id === sourceId) ? sourceId : '';
  let target = devices.some((d) => d.id === targetId) ? targetId : '';

  if (physicalDevices.length > 0) {
    const firstReal = physicalDevices[0];
    if (!source) source = firstReal.id;
    if (!target) {
      const fallback = devices.find((d) => d.id !== firstReal.id);
      if (fallback) target = fallback.id;
    }
  } else if (devices.length >= 2) {
    if (!source) source = devices[0].id;
    if (!target) {
      const fallback = devices.find((d) => d.id !== devices[0].id);
      if (fallback) target = fallback.id;
    }
  } else if (devices.length === 1 && !source) {
    source = devices[0].id;
  }

  return { source, target };
}

export default function DataTransfer() {
  const { t, isRTL } = useI18n();
  const { shopName, logoUrl } = useBranding();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<TransferStep>('connect');
  const [sourceDeviceId, setSourceDeviceId] = useState<string>('');
  const [targetDeviceId, setTargetDeviceId] = useState<string>('');
  const [selectedCategories, setSelectedCategories] = useState<TransferCategory[]>([
    'contacts',
    'photos',
    'videos',
    'audio',
    'documents',
    'messages',
    'calls',
  ]);
  const [virtualEnabled, setVirtualEnabled] = useState<boolean>(true);
  const [showWifiModal, setShowWifiModal] = useState<boolean>(false);
  const [showCancelDialog, setShowCancelDialog] = useState<boolean>(false);
  const [showPrintReceipt, setShowPrintReceipt] = useState<boolean>(false);
  const [, setActiveSession] = useState<TransferSessionRecord | null>(null);
  const [progress, setProgress] = useState<TransferProgressEvent | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [summary, setSummary] = useState<TransferSummaryReport | null>(null);
  const [auditLogs, setAuditLogs] = useState<TransferLogRecord[]>([]);
  const [showAllLogs, setShowAllLogs] = useState<boolean>(false);

  // Fetch connected devices
  const { data: devices = [], refetch: refetchDevices, isFetching: isRefreshingDevices } = useQuery<DeviceInfo[]>({
    queryKey: ['transfer-devices'],
    queryFn: () => invoke<DeviceInfo[]>('list_transfer_devices'),
    refetchInterval: step === 'connect' ? 4000 : false,
  });

  const physicalDevices = useMemo(() => devices.filter((d) => !d.is_virtual), [devices]);
  const demoDevices = useMemo(() => devices.filter((d) => d.is_virtual), [devices]);

  // Priority auto-selection: real physical devices win over demo devices when a
  // slot is empty, but explicit user choices (including swaps) are never
  // silently overridden. Stale selections (device unplugged / demos disabled)
  // are cleared so a transfer can never start against a missing device.
  // Applied during render rather than in an effect: the selection settles in the same pass,
  // and the state only changes when the resolved ids differ, so it cannot loop.
  const resolvedSelection = resolveDeviceSelection(devices, physicalDevices, sourceDeviceId, targetDeviceId);
  if (resolvedSelection.source !== sourceDeviceId) setSourceDeviceId(resolvedSelection.source);
  if (resolvedSelection.target !== targetDeviceId) setTargetDeviceId(resolvedSelection.target);

  // Scan category data for selected source device
  const { data: scanSummary } = useQuery<DeviceDataSummary>({
    queryKey: ['device-scan', sourceDeviceId],
    queryFn: () => invoke<DeviceDataSummary>('scan_device_data', { deviceId: sourceDeviceId }),
    enabled: !!sourceDeviceId && (step === 'connect' || step === 'categories'),
  });

  // Wi-Fi server info query (polls while the hotspot is running so the PIN/QR stay fresh)
  const { data: wifiInfo, refetch: refetchWifi } = useQuery<WifiServerInfo | null>({
    queryKey: ['wifi-transfer-server'],
    queryFn: () => invoke<WifiServerInfo | null>('get_wifi_transfer_server_info'),
    refetchInterval: (query) => (query.state.data ? 5000 : false),
  });

  // Listen to Tauri real-time events
  useEffect(() => {
    const unlistenProgress = listen<TransferProgressEvent>('transfer-progress', (event) => {
      setProgress(event.payload);
      setStep((prev) => (prev === 'completed' ? prev : 'transferring'));
    });

    const unlistenCompleted = listen<TransferSummaryReport>('transfer-completed', (event) => {
      const report = event.payload;
      setIsPaused(false);

      // A cancelled migration returns to the connect screen, not the receipt
      if (report.status === 'cancelled') {
        setProgress(null);
        setSummary(null);
        setStep('connect');
        return;
      }

      setSummary(report);
      setStep('completed');
      queryClient.invalidateQueries({ queryKey: ['transfer-sessions'] });
      invoke<TransferLogRecord[]>('get_transfer_logs', { sessionId: report.session_id })
        .then((logs) => setAuditLogs(logs))
        .catch(() => {});
    });

    const unlistenError = listen<string>('transfer-error', (event) => {
      toast.error(event.payload || t('transfer.failed'));
    });

    const unlistenDeviceUpdate = listen<DeviceInfo[]>('transfer-device-list-updated', () => {
      queryClient.invalidateQueries({ queryKey: ['transfer-devices'] });
    });

    const unlistenPhysicalConnected = listen<DeviceInfo>('physical-device-connected', (event) => {
      const dev = event.payload;
      toast.success(t('xfer.usbDetectedToast', { name: dev.name, model: dev.model }), { duration: 6000 });
      setSourceDeviceId(dev.id);
      queryClient.invalidateQueries({ queryKey: ['transfer-devices'] });
    });

    const unlistenPhysicalDisconnected = listen<string>('physical-device-disconnected', (event) => {
      toast.info(t('xfer.usbDisconnectedToast', { name: event.payload }));
      queryClient.invalidateQueries({ queryKey: ['transfer-devices'] });
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenCompleted.then((f) => f());
      unlistenError.then((f) => f());
      unlistenDeviceUpdate.then((f) => f());
      unlistenPhysicalConnected.then((f) => f());
      unlistenPhysicalDisconnected.then((f) => f());
    };
  }, [queryClient, t]);

  const sourceDevice = useMemo(() => devices.find((d) => d.id === sourceDeviceId) ?? null, [devices, sourceDeviceId]);
  const targetDevice = useMemo(() => devices.find((d) => d.id === targetDeviceId) ?? null, [devices, targetDeviceId]);

  // Toggle virtual devices
  const toggleVirtualDevices = async () => {
    const next = !virtualEnabled;
    setVirtualEnabled(next);
    try {
      await invoke('enable_virtual_devices', { enabled: next });
      refetchDevices();
      toast.success(next ? t('xfer.demoEnabled') : t('xfer.demoDisabled'));
    } catch (e) {
      setVirtualEnabled(!next); // revert the toggle on failure
      toast.error(errorMessage(e));
    }
  };

  // Swap Source and Target roles
  const handleSwapRoles = () => {
    const prevSrc = sourceDeviceId;
    const prevTgt = targetDeviceId;
    setSourceDeviceId(prevTgt);
    setTargetDeviceId(prevSrc);
    toast.info(t('xfer.swapped'));
  };

  // Toggle category checkbox
  const toggleCategory = (cat: TransferCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  // Calculate total selected size
  const selectedSizeMetrics = useMemo(() => {
    if (!scanSummary) return { count: 0, bytes: 0 };
    let count = 0;
    let bytes = 0;
    for (const c of scanSummary.categories) {
      if (selectedCategories.includes(c.category)) {
        count += c.item_count;
        bytes += c.total_bytes;
      }
    }
    return { count, bytes };
  }, [scanSummary, selectedCategories]);

  // Target storage check
  const isStorageWarning = useMemo(() => {
    if (!targetDevice || targetDevice.storage_free_bytes === 0) return false;
    return selectedSizeMetrics.bytes > targetDevice.storage_free_bytes;
  }, [targetDevice, selectedSizeMetrics.bytes]);

  // Start Transfer Mutation
  const startTransferMutation = useMutation({
    mutationFn: async () => {
      if (!sourceDeviceId || !targetDeviceId) {
        throw new Error(t('transfer.connectHint'));
      }
      if (sourceDeviceId === targetDeviceId) {
        throw new Error(t('transfer.sameDeviceError'));
      }
      if (selectedCategories.length === 0) {
        throw new Error(t('transfer.noCategoriesSelected'));
      }

      const session = await invoke<TransferSessionRecord>('start_phone_transfer', {
        req: {
          source_device_id: sourceDeviceId,
          target_device_id: targetDeviceId,
          categories: selectedCategories,
        },
      });
      return session;
    },
    onSuccess: (session) => {
      setActiveSession(session);
      setIsPaused(false);
      setProgress(null);
      setSummary(null);
      setAuditLogs([]);
      setStep('transferring');
      toast.success(t('transfer.transferring'));
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err));
    },
  });

  const handlePause = async () => {
    try {
      await invoke('pause_phone_transfer');
      setIsPaused(true);
      toast.info(t('transfer.paused'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleResume = async () => {
    try {
      await invoke('resume_phone_transfer');
      setIsPaused(false);
      toast.success(t('transfer.transferring'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleCancel = async () => {
    try {
      await invoke('cancel_phone_transfer');
      setShowCancelDialog(false);
      setIsPaused(false);
      setProgress(null);
      setStep('connect');
      toast.warning(t('transfer.cancelled'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleToggleWifiServer = async () => {
    try {
      if (wifiInfo) {
        await invoke('stop_wifi_transfer_server');
        toast.info(t('transfer.wifiStatusInactive'));
      } else {
        await invoke('start_wifi_transfer_server');
        toast.success(t('transfer.wifiStatusActive'));
      }
      await refetchWifi();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const stepOrder: TransferStep[] = ['connect', 'categories', 'transferring', 'completed'];
  const currentStepIndex = stepOrder.indexOf(step);

  // Selectable device card used by the source / target pickers (same state as before)
  const renderDeviceCard = (device: DeviceInfo, role: 'source' | 'target') => {
    const isSelected = role === 'source' ? device.id === sourceDeviceId : device.id === targetDeviceId;
    const isDisabled = role === 'target' && device.id === sourceDeviceId;

    return (
      <button
        key={device.id}
        type="button"
        aria-pressed={isSelected}
        disabled={isDisabled}
        onClick={() => (role === 'source' ? setSourceDeviceId(device.id) : setTargetDeviceId(device.id))}
        className={`w-full flex items-center gap-3.5 p-3.5 rounded-2xl border text-left transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 disabled:opacity-40 disabled:pointer-events-none ${
          isSelected
            ? 'border-navy bg-navy/[0.04] ring-[3px] ring-navy/15'
            : 'border-border bg-card hover:bg-surface'
        }`}
      >
        <div className="h-10 w-10 rounded-xl bg-surface flex items-center justify-center text-text-secondary flex-shrink-0">
          <Smartphone size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-text-primary truncate">{device.name}</div>
          <div className="text-[13px] text-text-secondary truncate">{device.model}</div>
        </div>
        <span
          className={`badge flex-shrink-0 ${
            device.is_virtual ? 'bg-accent-blue/10 text-accent-blue' : 'bg-accent-green/10 text-accent-green'
          }`}
        >
          {device.connection_type.toUpperCase()}
        </span>
        {isSelected && <Check size={16} strokeWidth={2.5} className="text-navy flex-shrink-0" />}
      </button>
    );
  };

  // Source / target picker panel listing the connected devices as selectable cards
  const renderDevicePicker = (role: 'source' | 'target') => {
    const label = role === 'source' ? t('xfer.selectSourcePhone') : t('xfer.selectTargetPhone');

    return (
      <div className="card p-5 space-y-4">
        <h2 className="text-[15px] font-semibold text-text-primary">{label}</h2>

        {physicalDevices.length > 0 && (
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-text-muted">{t('xfer.physicalSection')}</div>
            {physicalDevices.map((d) => renderDeviceCard(d, role))}
          </div>
        )}

        {demoDevices.length > 0 && (
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-text-muted">{t('xfer.demoSection')}</div>
            {demoDevices.map((d) => renderDeviceCard(d, role))}
          </div>
        )}

        {devices.length === 0 && <p className="text-[13px] text-text-secondary">{t('transfer.connectHint')}</p>}
      </div>
    );
  };

  return (
    <div className="p-5 md:p-8 max-w-7xl mx-auto space-y-6 animate-fade-up">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="h-11 w-11 rounded-2xl bg-navy/10 text-navy flex items-center justify-center flex-shrink-0">
            <Smartphone size={22} />
          </div>
          <div className="min-w-0">
            <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupDevices')}</span>
            <h1 className="page-title flex flex-wrap items-center gap-2.5">
              {t('transfer.title')}
              <span className="badge bg-accent-green/10 text-accent-green text-[13px]">{t('xfer.universal')}</span>
            </h1>
            <p className="page-subtitle">{t('transfer.subtitle')}</p>
          </div>
        </div>

        {/* Global Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleVirtualDevices}
            aria-pressed={virtualEnabled}
            className={`btn-secondary px-3.5 py-2 text-[13px] ${
              virtualEnabled ? 'bg-navy/10 border-navy/30 text-navy font-medium' : 'text-text-secondary'
            }`}
          >
            <Sparkles size={14} />
            {t('transfer.virtualDemo')}
          </button>

          <button
            type="button"
            onClick={() => {
              if (!wifiInfo) handleToggleWifiServer();
              setShowWifiModal(true);
            }}
            className="btn-secondary px-3.5 py-2 text-[13px] text-text-secondary"
          >
            <Wifi size={14} className={wifiInfo ? 'text-accent-green animate-pulse' : ''} />
            {t('transfer.wifiHotspotMode')}
          </button>

          <button
            type="button"
            onClick={() => refetchDevices()}
            disabled={isRefreshingDevices}
            aria-label={t('xfer.refreshDevices')}
            title={t('xfer.refreshDevices')}
            className="btn-secondary p-2.5 text-text-secondary"
          >
            <RotateCw size={15} className={isRefreshingDevices ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Step indicator */}
      <ol className="card p-2 grid grid-cols-4 gap-1">
        {stepOrder.map((s, idx) => {
          const isDone = idx < currentStepIndex;
          const isCurrent = idx === currentStepIndex;
          const labelKey = `transfer.step${idx + 1}` as const;

          return (
            <li
              key={s}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 min-w-0 transition-colors ${
                isCurrent ? 'bg-navy/10' : ''
              }`}
            >
              <span
                className={`h-7 w-7 rounded-full flex items-center justify-center text-[13px] font-semibold tabular-nums flex-shrink-0 ${
                  isDone
                    ? 'bg-accent-green text-white'
                    : isCurrent
                    ? 'bg-navy text-white'
                    : 'bg-surface border border-border text-text-muted'
                }`}
              >
                {isDone ? <Check size={14} strokeWidth={3} /> : idx + 1}
              </span>
              <span
                className={`text-[13px] truncate ${
                  isCurrent ? 'font-semibold text-navy' : isDone ? 'font-medium text-text-primary' : 'text-text-muted'
                }`}
              >
                {t(labelKey).replace(/^\d+\.\s*/, '')}
              </span>
            </li>
          );
        })}
      </ol>

      {/* USB Connection Status Banner */}
      {physicalDevices.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-accent-green/10 border border-accent-green/25 text-[13px]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent-green"></span>
            </span>
            <span className="font-semibold text-accent-green">
              {t('xfer.physicalConnected', { count: physicalDevices.length })}
            </span>
            <span className="font-medium text-text-primary truncate">
              {physicalDevices.map((d) => `${d.name} (${d.model})`).join(', ')}
            </span>
          </div>
          <span className="badge bg-accent-green/15 text-accent-green">{t('xfer.liveUsbReady')}</span>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-accent-orange/10 border border-accent-orange/25 text-[13px] text-text-secondary">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="text-accent-orange flex-shrink-0 mt-0.5" />
            <span>
              <b className="font-semibold text-text-primary">{t('xfer.waitingUsb')}</b> {t('xfer.waitingUsbSteps')} <b className="font-semibold text-text-primary">{t('xfer.trustComputer')}</b> {t('xfer.waitingUsbStepsEnd')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => refetchDevices()}
            className="btn-ghost px-3 py-1.5 text-[13px] font-medium text-navy flex-shrink-0"
          >
            {t('xfer.scanUsb')}
          </button>
        </div>
      )}

      {/* Transfer stage: source phone, data bridge, target phone */}
      <div className="card p-6 md:p-8 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-center justify-around gap-6 relative z-10">
          <PhoneMockup
            device={sourceDevice}
            role="source"
            isTransferring={step === 'transferring'}
            isCompleted={step === 'completed'}
            progress={progress}
            selectedCategories={selectedCategories}
          />

          <div className="flex-1 max-w-sm w-full py-2 flex flex-col items-center justify-center">
            <TransferDataBridge
              isTransferring={step === 'transferring'}
              isCompleted={step === 'completed'}
              isPaused={isPaused}
              progress={progress}
              onSwapRoles={handleSwapRoles}
              onPause={handlePause}
              onResume={handleResume}
              onCancel={() => setShowCancelDialog(true)}
            />
          </div>

          <PhoneMockup
            device={targetDevice}
            role="target"
            isTransferring={step === 'transferring'}
            isCompleted={step === 'completed'}
            progress={progress}
            selectedCategories={selectedCategories}
          />
        </div>
      </div>

      {/* STEP 1: DEVICE SELECTION */}
      {step === 'connect' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {renderDevicePicker('source')}
            {renderDevicePicker('target')}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-2 text-[13px] text-text-secondary">
              <ShieldCheck size={16} className="text-accent-green flex-shrink-0" />
              <span>{t('transfer.safeMode')}</span>
            </div>

            <button
              type="button"
              disabled={!sourceDeviceId || !targetDeviceId || sourceDeviceId === targetDeviceId}
              onClick={() => setStep('categories')}
              className="btn-primary px-6 py-3 text-[15px]"
            >
              <span>{t('transfer.next')}</span>
              {isRTL ? <ArrowRight size={16} className="rotate-180" /> : <ArrowRight size={16} />}
            </button>
          </div>
        </>
      )}

      {/* STEP 2: CATEGORY SELECTION */}
      {step === 'categories' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">{t('transfer.categories')}</h2>
              <p className="text-[13px] text-text-secondary mt-1 tabular-nums">
                {t('xfer.selectedSummary', { count: selectedSizeMetrics.count.toLocaleString(), size: formatBytes(selectedSizeMetrics.bytes) })}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategories(['contacts', 'messages', 'calls', 'calendars', 'photos', 'videos', 'audio', 'documents'])}
                className="btn-secondary px-3.5 py-2 text-[13px]"
              >
                {t('transfer.selectAll')}
              </button>
              <button
                type="button"
                onClick={() => setSelectedCategories([])}
                className="btn-ghost px-3.5 py-2 text-[13px]"
              >
                {t('transfer.deselectAll')}
              </button>
            </div>
          </div>

          {/* Storage Alert if applicable */}
          {isStorageWarning && (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-accent-orange/10 border border-accent-orange/25 text-[13px] font-medium text-accent-orange">
              <AlertTriangle size={18} className="flex-shrink-0" />
              <span>{t('transfer.insufficientStorage')}</span>
            </div>
          )}

          {/* Category checklist */}
          <div className="card divide-y divide-border-light overflow-hidden">
            {(scanSummary?.categories ?? []).map((cat) => {
              const isSelected = selectedCategories.includes(cat.category);
              const labelKey = `transfer.cat.${cat.category}` as const;

              return (
                <button
                  key={cat.category}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  onClick={() => toggleCategory(cat.category)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface/60 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-navy/30"
                >
                  <span
                    className={`h-5 w-5 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? 'bg-navy border-navy text-white' : 'border-border bg-card'
                    }`}
                  >
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </span>

                  <span className="h-9 w-9 rounded-xl bg-surface flex items-center justify-center flex-shrink-0">
                    {CATEGORY_ICONS[cat.category]}
                  </span>

                  <span
                    className={`flex-1 min-w-0 text-[14px] font-medium truncate ${
                      isSelected ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    {t(labelKey)}
                  </span>

                  <span className="w-24 text-right text-[13px] text-text-secondary tabular-nums hidden sm:block">
                    {t('xfer.itemCount', { count: cat.item_count.toLocaleString() })}
                  </span>

                  <span className="w-20 text-right text-[13px] font-medium text-text-primary tabular-nums">
                    {formatBytes(cat.total_bytes)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={() => setStep('connect')} className="btn-secondary px-5 py-2.5 text-[14px]">
              {t('transfer.back')}
            </button>

            <button
              type="button"
              disabled={selectedCategories.length === 0 || startTransferMutation.isPending}
              onClick={() => startTransferMutation.mutate()}
              className="btn-primary px-6 py-3 text-[15px]"
            >
              {startTransferMutation.isPending ? <RotateCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
              <span>{t('transfer.startMigration')}</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: AUDIT LOG & RECEIPT */}
      {step === 'completed' && summary && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowPrintReceipt(true)}
              className="btn-secondary px-5 py-2.5 text-[14px] text-navy"
            >
              <Printer size={15} />
              <span>{t('transfer.printReceipt')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('connect');
                setSummary(null);
                setProgress(null);
              }}
              className="btn-primary px-6 py-2.5 text-[14px]"
            >
              <span>{t('transfer.newTransfer')}</span>
            </button>
          </div>

          {/* Item Audit Log */}
          {auditLogs.length > 0 && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-text-primary">{t('transfer.auditLog')}</h3>
                <button
                  type="button"
                  onClick={() => setShowAllLogs(!showAllLogs)}
                  className="btn-ghost px-2.5 py-1.5 text-[13px] font-medium text-navy"
                >
                  {showAllLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>{showAllLogs ? t('xfer.showLess') : t('xfer.showAll', { count: auditLogs.length })}</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border-light text-[13px] text-text-muted">
                      <th className="pb-2.5 font-medium">{t('common.category')}</th>
                      <th className="pb-2.5 font-medium">{t('xfer.colItemName')}</th>
                      <th className="pb-2.5 font-medium">{t('xfer.colSize')}</th>
                      <th className="pb-2.5 font-medium">{t('xfer.colChecksum')}</th>
                      <th className="pb-2.5 font-medium text-right">{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {(showAllLogs ? auditLogs : auditLogs.slice(0, 10)).map((log) => (
                      <tr key={log.id} className="hover:bg-surface/60 transition-colors">
                        <td className="py-3 text-text-secondary capitalize">{log.category in CATEGORY_ICONS ? t(`transfer.cat.${log.category}`) : log.category}</td>
                        <td className="py-3 font-medium text-text-primary truncate max-w-xs">{log.item_name}</td>
                        <td className="py-3 text-text-secondary tabular-nums">{formatBytes(log.item_size)}</td>
                        <td className="py-3 font-mono text-[13px] text-text-muted truncate max-w-[140px]">
                          {log.checksum ? log.checksum.substring(0, 12) + '...' : '-'}
                        </td>
                        <td className="py-3 text-right">
                          <span
                            className={`badge capitalize ${
                              log.status === 'success'
                                ? 'bg-accent-green/10 text-accent-green'
                                : log.status === 'skipped'
                                ? 'bg-accent-blue/10 text-accent-blue'
                                : 'bg-accent-red/10 text-accent-red'
                            }`}
                          >
                            {log.status === 'success' ? t('transfer.statusSuccess') : log.status === 'skipped' ? t('transfer.statusSkipped') : log.status === 'failed' ? t('transfer.statusFailed') : log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Wireless Wi-Fi / Hotspot QR Code Modal */}
      {showWifiModal && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md p-6 space-y-5 bg-card border border-border rounded-2xl shadow-raised animate-fade-up">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-accent-green/10 text-accent-green flex items-center justify-center flex-shrink-0">
                  <Wifi size={18} />
                </div>
                <h3 className="text-[17px] font-semibold tracking-tight text-text-primary">{t('transfer.qrModalTitle')}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowWifiModal(false)}
                aria-label={t('common.close')}
                className="btn-ghost p-1.5 text-text-muted"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-[13px] text-text-secondary">{t('transfer.qrModalDesc')}</p>

            {wifiInfo ? (
              <div className="flex flex-col items-center gap-5 text-center">
                {/* QR stays white so it scans reliably in either theme */}
                <div className="p-4 bg-white rounded-2xl border border-border-light shadow-sm">
                  <img src={wifiInfo.qr_code_data_url} alt={t('xfer.qrAlt')} className="w-56 h-56 mx-auto object-contain" />
                </div>

                <div className="space-y-1.5">
                  <div className="eyebrow">{t('transfer.pinCode')}</div>
                  <div className="text-[32px] font-semibold tracking-[0.18em] tabular-nums text-navy">{wifiInfo.pin}</div>
                  <p className="text-[13px] text-text-muted">{t('transfer.pinDesc')}</p>
                </div>

                <div className="w-full p-3 rounded-xl bg-surface border border-border-light text-[13px] text-text-secondary font-mono truncate">
                  {wifiInfo.connect_url}
                </div>
              </div>
            ) : (
              <div className="py-10 text-center">
                <RotateCw size={24} className="animate-spin mx-auto text-text-muted" />
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              {wifiInfo && (
                <button
                  type="button"
                  onClick={async () => {
                    setShowWifiModal(false);
                    await handleToggleWifiServer();
                  }}
                  className="btn-secondary px-4 py-2.5 text-[14px] text-accent-red"
                >
                  <XCircle size={14} />
                  {t('transfer.stopWifiServer')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowWifiModal(false)}
                className="btn-primary px-5 py-2.5 text-[14px] ml-auto"
              >
                {t('xfer.done')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog on Cancel */}
      <ConfirmDialog
        open={showCancelDialog}
        title={t('transfer.cancel')}
        description={t('transfer.cancelConfirm')}
        confirmLabel={t('xfer.yesCancel')}
        variant="danger"
        onConfirm={handleCancel}
        onCancel={() => setShowCancelDialog(false)}
      />

      {/* Customer Transfer Receipt Modal */}
      {showPrintReceipt && summary && (
        <TransferReceiptModal
          summary={summary}
          shopName={shopName}
          logoUrl={logoUrl}
          onClose={() => setShowPrintReceipt(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// THERMAL RECEIPT PRINT MODAL
// ============================================================================

function TransferReceiptModal({
  summary,
  shopName,
  logoUrl,
  onClose,
}: {
  summary: TransferSummaryReport;
  shopName: string;
  logoUrl: string;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const handlePrint = () => {
    window.print();
  };

  // The receipt is a printed document: it stays white with dark ink in both themes.
  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm p-6 space-y-4 bg-white text-black border border-black/10 rounded-2xl shadow-raised font-mono text-[13px] animate-fade-up">
        <div className="text-center pb-3 border-b border-dashed border-black/15 space-y-1">
          <img src={logoUrl} alt={shopName} className="h-10 mx-auto object-contain filter grayscale" />
          <h2 className="text-sm font-bold tracking-tight">{shopName}</h2>
          <p className="text-[13px] text-black/55">{t('xfer.rcpTitle')}</p>
          <p className="text-[13px] text-black/55">{new Date().toLocaleString()}</p>
        </div>

        <div className="space-y-1 text-[13px]">
          <div className="flex justify-between">
            <span className="text-black/55">{t('xfer.rcpSession')}</span>
            <span className="font-bold">#TRF-{summary.session_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-black/55">{t('xfer.rcpSource')}</span>
            <span className="font-bold truncate max-w-[160px]">{summary.source_device_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-black/55">{t('xfer.rcpDestination')}</span>
            <span className="font-bold truncate max-w-[160px]">{summary.target_device_name}</span>
          </div>
        </div>

        <div className="py-2 border-y border-dashed border-black/15 space-y-1 text-[13px]">
          <div className="flex justify-between">
            <span>{t('xfer.rcpItems')}</span>
            <span className="font-bold">{summary.transferred_items}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('xfer.rcpVolume')}</span>
            <span className="font-bold">{formatBytes(summary.transferred_bytes)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('xfer.rcpDuration')}</span>
            <span className="font-bold">{formatDuration(summary.duration_seconds)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('xfer.rcpAvgSpeed')}</span>
            <span className="font-bold">{summary.average_speed_mbps.toFixed(1)} MB/s</span>
          </div>
        </div>

        <div className="text-center pt-2 space-y-2 text-[13px] text-black/55">
          <p>{t('xfer.rcpFooter')}</p>
          <div className="pt-4 border-t border-black/15">
            <p>{t('xfer.rcpSignature')} _____________________</p>
          </div>
        </div>

        <div className="flex gap-2 pt-3 print:hidden">
          <button
            type="button"
            onClick={handlePrint}
            className="btn-primary flex-1 py-2.5 text-[13px] shadow-none"
          >
            {t('common.print')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 inline-flex items-center justify-center rounded-xl border border-black/15 py-2.5 text-[13px] font-medium text-black hover:bg-black/5 transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
