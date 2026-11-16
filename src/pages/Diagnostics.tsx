import PhoneToolsNotice from '../components/PhoneToolsNotice';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import { useBranding } from '../hooks/brandingContext';
import type {
  FullDeviceDiagnosticReport,
  DeviceInspectionRecord,
  DiagnosticServerInfo,
  MobileDiagnosticSyncEvent,
  VirtualDeviceOption,
  DeviceInfo,
  Product,
  ConvertToVariantResponse,
  ComponentStatus,
} from '../lib/types';
import {
  ShieldCheck,
  Smartphone,
  BatteryCharging,
  QrCode,
  Printer,
  FileCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCw,
  PlusCircle,
  Layers,
  History,
  Lock,
  Unlock,
  Sliders,
  Sparkles,
  Info,
  Circle,
  Zap,
} from 'lucide-react';
import { ManualTestingStudio } from '../components/ManualTestingStudio';

// Renders **bold** segments of a translated string as <b> elements.
function renderRich(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <b key={i} className="text-text-primary">{part}</b> : part
  );
}

interface DeviceItem {
  id: string;
  name: string;
  brand: string;
  platform: string;
}

export default function Diagnostics() {
  const { t } = useI18n();
  const { shopName, logoUrl } = useBranding();

  // Devices & Loading
  const [connectedDevices, setConnectedDevices] = useState<DeviceItem[]>([]);
  const [, setVirtualDevices] = useState<VirtualDeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  // Starts true because the device list is loaded on mount.
  const [loading, setLoading] = useState<boolean>(true);
  const [probing, setProbing] = useState<boolean>(false);

  // Active Diagnostic Report
  const [report, setReport] = useState<FullDeviceDiagnosticReport | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [technicianNotes, setTechnicianNotes] = useState<string>('');

  // Mobile Web Companion (QR Code)
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [serverInfo, setServerInfo] = useState<DiagnosticServerInfo | null>(null);
  const [lastSyncEvent, setLastSyncEvent] = useState<MobileDiagnosticSyncEvent | null>(null);
  const [companionConnected, setCompanionConnected] = useState<boolean>(false);

  // Modals & Drawers
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [historyList, setHistoryList] = useState<DeviceInspectionRecord[]>([]);
  const [showVariantModal, setShowVariantModal] = useState<boolean>(false);
  const [showCertModal, setShowCertModal] = useState<boolean>(false);
  const [showStudioModal, setShowStudioModal] = useState<boolean>(false);
  const [savedInspection, setSavedInspection] = useState<DeviceInspectionRecord | null>(null);

  // Variant conversion state
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [variantName, setVariantName] = useState<string>('');
  const [variantCost, setVariantCost] = useState<number>(0);
  const [variantPrice, setVariantPrice] = useState<number>(0);
  const [variantQuantity, setVariantQuantity] = useState<number>(1);
  const [converting, setConverting] = useState<boolean>(false);

  // Live state mirrors for stable callbacks — the device loader and prober
  // read these refs instead of closing over state, so their identities never
  // change and USB re-scans cannot retrigger effects in an infinite loop.
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  const connectedDevicesRef = useRef(connectedDevices);
  const reportRef = useRef<FullDeviceDiagnosticReport | null>(null);
  const lastProbedRef = useRef<string>('');
  // Stable callbacks below read the latest translator through this ref.
  const tRef = useRef(t);
  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
    connectedDevicesRef.current = connectedDevices;
    reportRef.current = report;
    tRef.current = t;
  }, [selectedDeviceId, connectedDevices, report, t]);

  // Deep probe device
  const handleProbe = useCallback(async (devId?: string, platformOverride?: string) => {
    const targetId = devId || selectedDeviceIdRef.current;
    if (!targetId) {
      toast.error(tRef.current('diag.toast.selectDevice'));
      return;
    }

    setProbing(true);
    try {
      const found = connectedDevicesRef.current.find((d) => d.id === targetId);
      const rep = await invoke<FullDeviceDiagnosticReport>('probe_device', {
        deviceId: targetId,
        platform: platformOverride || found?.platform || null,
      });
      setReport(rep);
      setSavedInspection(null);
      lastProbedRef.current = targetId;

      // Calculate default variant pricing
      const basePrice = rep.brand === 'Apple' ? 850 : 750;
      const suggestedCost = Math.round(basePrice * rep.grading.valuation_multiplier);
      setVariantCost(suggestedCost);
      setVariantPrice(Math.round(suggestedCost * 1.25));
      setVariantName(`[Grade ${rep.grading.grade}] ${rep.model}`);

      toast.success(tRef.current('diag.toast.inspectionDone', { model: rep.model }));
    } catch (e) {
      toast.error(tRef.current('diag.toast.probeFailed', { error: String(e) }));
    } finally {
      setProbing(false);
    }
  }, []);

  // Fetch the device list. It does not touch `loading` synchronously; callers
  // that want the spinner set it first (see loadDevices below).
  const fetchDevices = useCallback(async () => {
    try {
      // 1. Get raw devices from detector
      const rawDevs = await invoke<DeviceInfo[]>('list_transfer_devices').catch(() => []);

      // Separate physical USB devices from virtual demo devices
      const physicalDevs: DeviceItem[] = rawDevs
        .filter((d) => !d.is_virtual && !d.id.startsWith('virt-') && !d.id.startsWith('demo-'))
        .map((d) => ({
          id: d.id,
          name: d.name,
          brand: d.brand,
          platform: d.platform,
        }));

      // 2. Get virtual demo devices
      const vDevs = await invoke<VirtualDeviceOption[]>('list_virtual_diagnostic_devices').catch(() => []);
      setVirtualDevices(vDevs);

      const demoDevs: DeviceItem[] = vDevs.map((v) => ({
        id: v.id,
        name: tRef.current('diag.demoDevice', { name: v.name }),
        brand: v.brand,
        platform: v.os.includes('iOS') ? 'iOS' : v.os.includes('Harmony') ? 'HarmonyOS' : 'Android',
      }));

      // Physical USB devices ALWAYS first!
      const allDevices = [...physicalDevs, ...demoDevs];
      setConnectedDevices(allDevices);

      // If a real physical device is connected, always prioritize it!
      const currentId = selectedDeviceIdRef.current;
      if (physicalDevs.length > 0) {
        if (!currentId || currentId.startsWith('virt-') || currentId.startsWith('demo-')) {
          setSelectedDeviceId(physicalDevs[0].id);
        }
      } else if (allDevices.length > 0 && !currentId) {
        setSelectedDeviceId(allDevices[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load available devices (shows the loading state)
  const loadDevices = useCallback(() => {
    setLoading(true);
    return fetchDevices();
  }, [fetchDevices]);

  // Initial load: `loading` already starts as true
  useEffect(() => {
    (async () => {
      await fetchDevices();
    })();
  }, [fetchDevices]);

  // Auto-probe whenever the selection changes (guarded so a failed probe on a
  // locked/unauthorized phone doesn't retry in a tight loop)
  useEffect(() => {
    if (selectedDeviceId && selectedDeviceId !== lastProbedRef.current) {
      handleProbe(selectedDeviceId);
    }
  }, [selectedDeviceId, handleProbe]);

  // Recalculate grading if report tests change manually
  const toggleHardwareTest = useCallback(async (testKey: string, currentPassed: boolean) => {
    if (!reportRef.current) return;
    try {
      const updated = await invoke<FullDeviceDiagnosticReport>('update_report_test', {
        report: reportRef.current,
        testKey,
        passed: !currentPassed,
        details: !currentPassed ? tRef.current('diag.detail.manualVerified') : tRef.current('diag.detail.manualFailure'),
      });
      setReport(updated);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Stable identity — the Manual Testing Studio registers listeners in an
  // effect keyed on this callback, so it must not churn every render.
  const handleUpdateHardwareTest = useCallback(async (testKey: string, passed: boolean, details?: string) => {
    if (!reportRef.current) return;
    try {
      const updated = await invoke<FullDeviceDiagnosticReport>('update_report_test', {
        report: reportRef.current,
        testKey,
        passed,
        details: details || (passed ? tRef.current('diag.detail.manualVerified') : tRef.current('diag.detail.manualFailure')),
      });
      setReport(updated);
      toast.success(tRef.current('diag.toast.testUpdated', { key: testKey, status: passed ? tRef.current('diag.status.passed') : tRef.current('diag.status.failed') }));
    } catch (e) {
      console.error(e);
      toast.error(tRef.current('diag.toast.updateFailed', { error: String(e) }));
    }
  }, []);

  // Batch auto-verify remaining untested sensors
  const handleBatchVerifySensors = useCallback(async () => {
    if (!reportRef.current) return;
    const tests = Object.values(reportRef.current.hardware_tests);
    const untested = tests.filter((t) => !t.tested);
    if (untested.length === 0) {
      toast.info(tRef.current('diag.detail.manualVerified'));
      return;
    }

    const updates = untested.map((t) => ({
      key: t.key,
      passed: true,
      details: tRef.current('diag.detail.manualVerified'),
    }));

    try {
      const updated = await invoke<FullDeviceDiagnosticReport>('batch_update_report_tests', {
        report: reportRef.current,
        updates,
      });
      setReport(updated);
      toast.success(tRef.current('diag.suite.verifyUntestedToast'));
    } catch (e) {
      console.error(e);
      toast.error(tRef.current('diag.toast.updateFailed', { error: String(e) }));
    }
  }, []);

  // Listen to live WebSocket events from mobile companion & USB auto-connect
  useEffect(() => {
    let unlistenSync: (() => void) | null = null;
    let unlistenPhysical: (() => void) | null = null;
    let unlistenListUpdate: (() => void) | null = null;
    let unlistenCompanionConnect: (() => void) | null = null;
    let unlistenCompanionDisconnect: (() => void) | null = null;

    // Check if companion server is already running & connected
    invoke<DiagnosticServerInfo | null>('get_diagnostic_server_info')
      .then((info) => {
        if (info) {
          setServerInfo(info);
          if (info.connected) {
            setCompanionConnected(true);
          }
        }
      })
      .catch(() => {});

    listen('mobile-companion-connected', () => {
      setCompanionConnected(true);
      toast.success(tRef.current('manual.toast.synced'));
    }).then((u) => {
      unlistenCompanionConnect = u;
    });

    listen('mobile-companion-disconnected', () => {
      setCompanionConnected(false);
    }).then((u) => {
      unlistenCompanionDisconnect = u;
    });

    listen<MobileDiagnosticSyncEvent>('diagnostic-test-synced', (event) => {
      const payload = event.payload;
      setLastSyncEvent(payload);
      // Route through the server-side updater so grading and the score are
      // recomputed exactly once per phone result (never mutate the report here).
      handleUpdateHardwareTest(
        payload.test_key,
        payload.passed,
        payload.details || tRef.current('diag.detail.liveVerified')
      );
    }).then((u) => {
      unlistenSync = u;
    });

    listen<DeviceInfo>('physical-device-connected', (event) => {
      const dev = event.payload;
      toast.success(tRef.current('diag.toast.usbConnected', { name: dev.name, model: dev.model }), { duration: 6000 });
      // The explicit probe below handles it — keep the auto-probe effect from
      // firing a duplicate request for the same device.
      lastProbedRef.current = dev.id;
      setSelectedDeviceId(dev.id);
      // Wait for the refreshed device list so the probe gets the right platform
      loadDevices().then(() => handleProbe(dev.id, dev.platform || undefined));
    }).then((u) => {
      unlistenPhysical = u;
    });

    listen<DeviceInfo[]>('transfer-device-list-updated', () => {
      loadDevices();
    }).then((u) => {
      unlistenListUpdate = u;
    });

    return () => {
      if (unlistenSync) unlistenSync();
      if (unlistenPhysical) unlistenPhysical();
      if (unlistenListUpdate) unlistenListUpdate();
      if (unlistenCompanionConnect) unlistenCompanionConnect();
      if (unlistenCompanionDisconnect) unlistenCompanionDisconnect();
    };
  }, [loadDevices, handleProbe, handleUpdateHardwareTest]);

  // Start mobile companion server
  const toggleQrModal = async () => {
    if (!showQrModal) {
      try {
        const info = await invoke<DiagnosticServerInfo>('start_diagnostic_server');
        setServerInfo(info);
        if (info.connected) {
          setCompanionConnected(true);
        }
        setShowQrModal(true);
      } catch (e) {
        toast.error(t('diag.toast.serverFailed', { error: String(e) }));
      }
    } else {
      setShowQrModal(false);
    }
  };

  // Save inspection report to DB
  const handleSaveReport = async () => {
    if (!report) return;
    try {
      const record = await invoke<DeviceInspectionRecord>('save_device_inspection', {
        req: {
          device_id: report.device_id,
          technician_notes: technicianNotes || null,
          report,
        },
      });
      setSavedInspection(record);
      toast.success(t('diagnostics.savedSuccess'));
    } catch (e) {
      toast.error(t('diag.toast.saveFailed', { error: String(e) }));
    }
  };

  // Load inspection history
  const loadHistory = async () => {
    try {
      const list = await invoke<DeviceInspectionRecord[]>('list_device_inspections', { limit: 30 });
      setHistoryList(list);
      setShowHistory(true);
    } catch (e) {
      toast.error(t('diag.toast.historyFailed', { error: String(e) }));
    }
  };

  // Load inventory products for variant conversion
  const openVariantModal = async () => {
    try {
      const prods = await invoke<Product[]>('get_products');
      setProducts(prods);
      if (prods.length > 0) {
        setSelectedProductId(prods[0].id);
      }
      setShowVariantModal(true);
    } catch (e) {
      toast.error(t('diag.toast.productsFailed', { error: String(e) }));
    }
  };

  // Convert to Variant
  const handleConvertToVariant = async () => {
    if (!savedInspection && !report) {
      toast.error(t('diag.toast.saveFirst'));
      return;
    }
    if (!selectedProductId) {
      toast.error(t('diag.toast.selectParent'));
      return;
    }

    setConverting(true);
    try {
      let recordId = savedInspection?.id;
      if (!recordId && report) {
        const record = await invoke<DeviceInspectionRecord>('save_device_inspection', {
          req: {
            device_id: report.device_id,
            technician_notes: technicianNotes || null,
            report,
          },
        });
        setSavedInspection(record);
        recordId = record.id;
      }

      const res = await invoke<ConvertToVariantResponse>('convert_inspection_to_variant', {
        req: {
          inspection_id: recordId,
          product_id: selectedProductId,
          variant_name: variantName,
          cost_price: Number(variantCost),
          selling_price: Number(variantPrice),
          quantity: Number(variantQuantity),
        },
      });

      toast.success(res.message);
      setShowVariantModal(false);
    } catch (e) {
      toast.error(t('diag.toast.variantFailed', { error: String(e) }));
    } finally {
      setConverting(false);
    }
  };

  // Thermal TSPL Print
  const handlePrintThermal = async () => {
    let recordId = savedInspection?.id;
    if (!recordId && report) {
      try {
        const record = await invoke<DeviceInspectionRecord>('save_device_inspection', {
          req: {
            device_id: report.device_id,
            technician_notes: technicianNotes || null,
            report,
          },
        });
        setSavedInspection(record);
        recordId = record.id;
      } catch (e) {
        toast.error(t('diag.toast.savePrintFailed', { error: String(e) }));
        return;
      }
    }

    if (!recordId) return;

    try {
      await invoke('print_inspection_label', {
        inspectionId: recordId,
        printerName: null,
        opts: null,
      });
      toast.success(t('diag.toast.thermalSent'));
    } catch (e) {
      toast.error(t('diag.toast.thermalFailed', { error: String(e) }));
    }
  };

  // Filter hardware tests by category
  // How many of the hardware tests have actually been run. A test nobody has
  // run is "not tested", never "failed".
  const testedCount = useMemo(
    () => (report ? Object.values(report.hardware_tests).filter((x) => x.tested).length : 0),
    [report],
  );
  // Capacity couldn't be read at all: show it as unknown, not as 0 mAh / 100%.
  const batteryUnmeasured = !!report && !!report.battery.estimated && report.battery.actual_capacity_mah === 0;
  const testsSummary = report
    ? testedCount === 0
      ? t('diag.notTestedYet')
      : t('diag.testsProgress', { tested: testedCount, total: report.grading.total_count, passed: report.grading.passed_count })
    : '';

  const filteredTests = useMemo(() => {
    if (!report) return [];
    const tests = Object.values(report.hardware_tests);
    if (selectedCategory === 'all') return tests;
    return tests.filter((t) => t.category === selectedCategory);
  }, [report, selectedCategory]);

  // Filter pills with live counts derived from the current report; categories
  // with no tests in this device's suite are hidden entirely.
  const testCategories = useMemo(() => {
    const tests = report ? Object.values(report.hardware_tests) : [];
    const withCounts = [
      { id: 'all', label: t('diag.categoryCount', { label: t('diagnostics.allCategories'), count: tests.length }), count: tests.length },
      { id: 'touch', label: t('diag.categoryCount', { label: t('diag.test.cat.touch'), count: tests.filter((x) => x.category === 'touch').length }), count: tests.filter((x) => x.category === 'touch').length },
      { id: 'display', label: t('diag.categoryCount', { label: t('diag.test.cat.display'), count: tests.filter((x) => x.category === 'display').length }), count: tests.filter((x) => x.category === 'display').length },
      { id: 'audio', label: t('diag.categoryCount', { label: t('diag.test.cat.audio'), count: tests.filter((x) => x.category === 'audio').length }), count: tests.filter((x) => x.category === 'audio').length },
      { id: 'camera', label: t('diag.categoryCount', { label: t('diag.test.cat.camera'), count: tests.filter((x) => x.category === 'camera').length }), count: tests.filter((x) => x.category === 'camera').length },
      { id: 'biometrics', label: t('diag.categoryCount', { label: t('diag.test.cat.biometrics'), count: tests.filter((x) => x.category === 'biometrics').length }), count: tests.filter((x) => x.category === 'biometrics').length },
      { id: 'sensors', label: t('diag.categoryCount', { label: t('diag.test.cat.sensors'), count: tests.filter((x) => x.category === 'sensors').length }), count: tests.filter((x) => x.category === 'sensors').length },
      { id: 'buttons', label: t('diag.categoryCount', { label: t('diag.test.cat.buttons'), count: tests.filter((x) => x.category === 'buttons').length }), count: tests.filter((x) => x.category === 'buttons').length },
      { id: 'haptics', label: t('diag.categoryCount', { label: t('diag.test.cat.haptics'), count: tests.filter((x) => x.category === 'haptics').length }), count: tests.filter((x) => x.category === 'haptics').length },
      { id: 'connectivity', label: t('diag.categoryCount', { label: t('diag.test.cat.connectivity'), count: tests.filter((x) => x.category === 'connectivity').length }), count: tests.filter((x) => x.category === 'connectivity').length },
    ];
    return withCounts.filter((cat) => cat.id === 'all' || cat.count > 0);
  }, [report, t]);

  const statusLabel = (status: ComponentStatus): string => {
    switch (status) {
      case 'original':
        return t('diag.status.original');
      case 'replaced_oem':
        return t('diag.status.replacedOem');
      case 'replaced_third_party':
        return t('diag.status.thirdParty');
      case 'defective':
        return t('diag.status.defective');
      default:
        return t('diag.status.unknown');
    }
  };

  const getStatusBadge = (status: ComponentStatus) => {
    switch (status) {
      case 'original':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-semibold bg-accent-green/10 text-accent-green border border-accent-green/30">
            <CheckCircle2 size={13} /> {t('diag.status.original')}
          </span>
        );
      case 'replaced_oem':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-semibold bg-accent-blue/10 text-accent-blue border border-accent-blue/30">
            <CheckCircle2 size={13} /> {t('diag.status.replacedOem')}
          </span>
        );
      case 'replaced_third_party':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-semibold bg-accent-orange/10 text-accent-orange border border-accent-orange/30">
            <AlertTriangle size={13} /> {t('diag.status.thirdParty')}
          </span>
        );
      case 'defective':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-semibold bg-accent-red/10 text-accent-red border border-accent-red/30">
            <XCircle size={13} /> {t('diag.status.defective')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-semibold bg-text-muted/10 text-text-muted border border-text-muted/30">
            {t('diag.status.unknown')}
          </span>
        );
    }
  };

  // One accent per grade: a tinted surface, the accent text colour and a solid
  // pill for compact badges. No gradients, no neon blocks.
  const getGradeColors = (grade: string) => {
    switch (grade) {
      case 'A+':
        return {
          text: 'text-accent-green',
          bg: 'bg-accent-green/10 border-accent-green/30',
          badge: 'bg-accent-green text-white font-bold',
        };
      case 'A':
        return {
          text: 'text-accent-blue',
          bg: 'bg-accent-blue/10 border-accent-blue/30',
          badge: 'bg-accent-blue text-white font-bold',
        };
      case 'B':
      case 'C':
        return {
          text: 'text-accent-orange',
          bg: 'bg-accent-orange/10 border-accent-orange/30',
          badge: 'bg-accent-orange text-white font-bold',
        };
      default:
        return {
          text: 'text-accent-red',
          bg: 'bg-accent-red/10 border-accent-red/30',
          badge: 'bg-accent-red text-white font-bold',
        };
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 text-text-primary bg-surface min-h-screen animate-fade-up">
      {/* Top Bar */}
      <div className="card flex flex-col gap-5 p-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-navy/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-navy" />
            </div>
            <div>
              <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupDevices')}</span>
              <h1 className="page-title flex items-center gap-2.5">
                {t('diagnostics.title')}
                <span className="badge bg-navy/10 text-navy">Universal Probe 2.0</span>
              </h1>
              <p className="page-subtitle">{t('diagnostics.subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Device Selector & Actions */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-border-light pt-4">
          <div className="relative min-w-[240px]">
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="form-input py-2 text-[13px] font-medium"
            >
              {connectedDevices.length === 0 && <option value="">{t('diag.noDevices')}</option>}
              {connectedDevices.filter((d) => !d.id.startsWith('virt-') && !d.id.startsWith('demo-')).length > 0 && (
                <optgroup label={t('diag.group.physical')}>
                  {connectedDevices
                    .filter((d) => !d.id.startsWith('virt-') && !d.id.startsWith('demo-'))
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        ⚡ {d.name} ({d.platform})
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label={t('diag.group.demo')}>
                {connectedDevices
                  .filter((d) => d.id.startsWith('virt-') || d.id.startsWith('demo-'))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>

          <button
            onClick={() => handleProbe()}
            disabled={probing}
            className="btn-primary"
          >
            <RotateCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
            {probing ? t('diagnostics.probing') : t('diagnostics.probeDevice')}
          </button>

          <button
            onClick={toggleQrModal}
            className={`btn-secondary flex items-center gap-1.5 ${
              companionConnected ? 'border-accent-green/50 text-accent-green bg-accent-green/10 font-bold' : ''
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                companionConnected ? 'bg-accent-green animate-pulse' : 'bg-text-muted'
              }`}
            />
            <QrCode className="w-3.5 h-3.5" />
            {companionConnected
              ? t('diag.companion.connectedBadge')
              : t('diagnostics.qrSync')}
          </button>

          <button
            onClick={loadHistory}
            className="btn-secondary"
          >
            <History className="w-3.5 h-3.5 text-accent-blue" />
            {t('diagnostics.history')}
          </button>
        </div>
      </div>

      {/* USB Phone Detection Status Banner */}
      {connectedDevices.filter((d) => !d.id.startsWith('virt-') && !d.id.startsWith('demo-')).length > 0 ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-accent-green/10 border border-accent-green/30 rounded-2xl text-[13px] text-text-secondary">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent-green"></span>
            </span>
            <span className="font-semibold text-text-primary">
              {t('diag.usb.detected', { count: connectedDevices.filter((d) => !d.id.startsWith('virt-') && !d.id.startsWith('demo-')).length })}
            </span>
            <span className="truncate">
              {connectedDevices
                .filter((d) => !d.id.startsWith('virt-') && !d.id.startsWith('demo-'))
                .map((d) => `${d.name} (${d.platform})`)
                .join(', ')}
            </span>
          </div>
          <span className="badge bg-accent-green/15 text-accent-green flex-shrink-0">
            {t('diag.usb.ready')}
          </span>
        </div>
      ) : (
        <>
        <PhoneToolsNotice />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 bg-accent-orange/10 border border-accent-orange/30 rounded-2xl text-[13px] text-text-secondary">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-accent-orange flex-shrink-0" />
            <span>
              {renderRich(t('diag.usb.none'))}
            </span>
          </div>
          <button
            onClick={() => loadDevices()}
            disabled={loading}
            className="btn-ghost px-2 py-1 text-[13px] font-semibold text-navy flex-shrink-0"
          >
            {t('diag.usb.scan')}
          </button>
        </div>
        </>
      )}

      {report ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Device Identity & Specifications (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            {/* Identity Card */}
            <div className="card p-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-accent-blue/5 rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="eyebrow mb-1">
                    {report.brand}
                  </div>
                  <h2 className="text-lg font-bold text-text-primary leading-tight">{report.model}</h2>
                  <div className="text-[13px] text-accent-blue mt-0.5">{report.os_version}</div>
                  
                  {/* Live Battery Charge & Health Badges */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {report.battery.current_charge_percentage != null && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[13px] font-bold bg-accent-green/15 text-accent-green border border-accent-green/30">
                        <Zap size={11} className={report.battery.is_charging ? 'animate-pulse' : ''} />
                        {t('diag.battery.chargeBadge', { percent: report.battery.current_charge_percentage, state: report.battery.is_charging ? t('diag.battery.charging') : '' })}
                      </span>
                    )}
                    {!batteryUnmeasured && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[13px] font-bold bg-accent-blue/15 text-accent-blue border border-accent-blue/30">
                        <BatteryCharging size={11} />
                        {t('diag.battery.healthBadge', { percent: report.battery.health_percentage })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-5 h-5 text-accent-blue" />
                </div>
              </div>

              {/* Hardware Specs Matrix */}
              <div className="space-y-2.5 text-[13px] border-t border-border pt-3">
                <div className="flex justify-between py-1 border-b border-border-light">
                  <span className="text-text-muted">{t('diag.spec.imei1')}</span>
                  <span className="font-mono text-text-primary">{report.imei1 || t('cert.na')}</span>
                </div>
                {report.imei2 && (
                  <div className="flex justify-between py-1 border-b border-border-light">
                    <span className="text-text-muted">{t('diag.spec.imei2')}</span>
                    <span className="font-mono text-text-primary">{report.imei2}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-border-light">
                  <span className="text-text-muted">{t('cert.device.serial')}</span>
                  <span className="font-mono text-text-primary">{report.serial_number || t('cert.na')}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border-light">
                  <span className="text-text-muted">{t('diag.spec.baseband')}</span>
                  <span className="font-mono text-text-primary">{report.baseband_version || t('cert.na')}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border-light">
                  <span className="text-text-muted">{t('diag.spec.cpu')}</span>
                  <span className="text-text-primary">{report.cpu_architecture}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-text-muted">{t('diag.spec.ram')}</span>
                  <span className="text-text-primary font-semibold">{report.ram_gb} GB</span>
                </div>
              </div>

              {/* Storage Bar */}
              <div className="mt-4 pt-3 border-t border-border">
                <div className="flex justify-between text-[13px] mb-1.5">
                  <span className="text-text-muted">{t('diag.storage.volume')}</span>
                  <span className="text-text-primary font-medium">
                    {t('diag.storage.freeOf', { free: Math.round(report.storage_free_bytes / (1024 * 1024 * 1024)), total: Math.round(report.storage_total_bytes / (1024 * 1024 * 1024)) })}
                  </span>
                </div>
                <div className="h-2 w-full bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-navy rounded-full"
                    style={{
                      width: `${Math.round(
                        ((report.storage_total_bytes - report.storage_free_bytes) /
                          report.storage_total_bytes) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Battery Gas Gauge Card */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BatteryCharging className="w-5 h-5 text-accent-green" />
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">{t('diagnostics.batteryGasGauge')}</h3>
                    <div className="text-[13px] text-text-muted">
                      {t('diag.battery.currentCharge')}{' '}
                      <span className="font-bold text-accent-green">
                        {report.battery.current_charge_percentage != null ? `${report.battery.current_charge_percentage}%` : '—'}
                      </span>{' '}
                      {report.battery.is_charging == null ? '' : report.battery.is_charging ? t('diag.battery.usbCharging') : t('diag.battery.discharging')}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-sm font-bold px-2.5 py-0.5 rounded-full inline-block ${
                      report.battery.health_percentage >= 85
                        ? 'bg-accent-green/20 text-accent-green border border-accent-green/30'
                        : report.battery.health_percentage >= 80
                        ? 'bg-accent-orange/20 text-accent-orange border border-accent-orange/30'
                        : 'bg-accent-red/20 text-accent-red border border-accent-red/30'
                    }`}
                  >
                    {batteryUnmeasured ? '—' : t('diag.battery.healthBadge', { percent: report.battery.health_percentage })}
                  </div>
                  <div className="text-[13px] text-text-muted mt-0.5">{t('diag.battery.peakCapacity')}</div>
                  {report.battery.estimated && (
                    <div className="text-[13px] font-semibold text-accent-orange mt-0.5">{t('diag.battery.estimated')}</div>
                  )}
                </div>
              </div>

              {/* Visual Charge Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[13px] text-text-muted">
                  <span>{t('diag.battery.chargeLevel')}</span>
                  <span className="font-bold text-text-primary">{report.battery.current_charge_percentage != null ? `${report.battery.current_charge_percentage}%` : '—'}</span>
                </div>
                <div className="h-2.5 w-full bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-green rounded-full transition-all duration-300"
                    style={{ width: `${report.battery.current_charge_percentage ?? 0}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-[13px]">
                <div className="bg-surface/60 p-2.5 rounded-xl border border-border">
                  <div className="text-text-muted">{t('diagnostics.batteryCycles')}</div>
                  <div className="text-base font-bold text-text-primary mt-0.5">{report.battery.cycle_count}</div>
                  {report.brand === 'Apple' && (
                    <div className="text-[13px] text-text-muted">{t('diag.battery.appleRated', { count: 1000 })}</div>
                  )}
                </div>

                <div className="bg-surface/60 p-2.5 rounded-xl border border-border">
                  <div className="text-text-muted">{t('diag.battery.capacityLabel')}</div>
                  <div className="text-sm font-bold text-accent-green mt-0.5">
                    {batteryUnmeasured ? '—' : `${report.battery.actual_capacity_mah} / ${report.battery.design_capacity_mah}`}
                    <span className="text-[13px] text-text-muted ms-1">mAh</span>
                  </div>
                  {!batteryUnmeasured && (
                    <div className="text-[13px] text-accent-red font-semibold">
                      {t('diag.battery.degraded', { lost: report.battery.design_capacity_mah - report.battery.actual_capacity_mah })}
                    </div>
                  )}
                </div>

                <div className="bg-surface/60 p-2.5 rounded-xl border border-border">
                  <div className="text-text-muted">{t('diagnostics.batteryTemp')}</div>
                  <div className="text-sm font-bold text-text-primary mt-0.5">
                    {report.battery.temperature_celsius != null ? `${report.battery.temperature_celsius.toFixed(1)}°C` : '—'}
                  </div>
                </div>

                <div className="bg-surface/60 p-2.5 rounded-xl border border-border">
                  <div className="text-text-muted">{t('diag.battery.cellSupplier')}</div>
                  <div className="text-[13px] font-semibold text-text-primary mt-0.5 truncate">
                    {report.battery.manufacturer || t('diag.battery.notReported')}
                  </div>
                </div>
              </div>

              {/* Interactive Health Calibration Slider for Technician */}
              <div className="p-3 rounded-xl bg-surface/40 border border-border space-y-2">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-text-secondary font-semibold flex items-center gap-1.5">
                    <Sliders size={12} className="text-accent-blue" />
                    {t('diag.battery.calibrate')}
                  </span>
                  <span className="font-bold text-accent-blue font-mono text-sm">
                    {report.battery.health_percentage}%
                  </span>
                </div>
                <input
                  type="range"
                  min="60"
                  max="100"
                  value={report.battery.health_percentage}
                  onChange={(e) => {
                    const newHealth = parseInt(e.target.value, 10);
                    const newActualMah = Math.round((report.battery.design_capacity_mah * newHealth) / 100);
                    setReport((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        battery: {
                          ...prev.battery,
                          health_percentage: newHealth,
                          actual_capacity_mah: newActualMah,
                        },
                      };
                    });
                  }}
                  className="w-full accent-navy h-1.5 bg-border rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[13px] text-text-muted">
                  <span>{t('diag.battery.degradedMark')}</span>
                  <span>{t('diag.battery.serviceMark')}</span>
                  <span>{t('diag.battery.pristineMark')}</span>
                </div>
              </div>

              {report.battery.serial_number && (
                <div className="mt-3 pt-2 text-[13px] text-text-muted flex items-center justify-between border-t border-border">
                  <span>{t('diag.serial')}</span>
                  <span className="font-mono text-text-secondary">{report.battery.serial_number}</span>
                </div>
              )}
            </div>

            {/* Security & Cloud Locks Card */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-5 h-5 text-accent-blue" />
                <h3 className="text-sm font-bold text-text-primary">{t('diagnostics.securityLocks')}</h3>
              </div>

              <div className="space-y-2 text-[13px]">
                {/* iCloud Lock / Apple ID */}
                <div className="p-2.5 rounded-xl bg-surface/50 border border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary font-medium">iCloud / Find My iPhone</span>
                    {report.security_locks.icloud_fmi_locked ? (
                      <span className="px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-red/20 text-accent-red border border-accent-red/40 flex items-center gap-1">
                        <Lock size={12} /> {t('diag.lock.icloudActivation')}
                      </span>
                    ) : report.security_locks.fmi_account_masked ? (
                      <span className="px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-blue/20 text-accent-blue border border-accent-blue/40 flex items-center gap-1">
                        <ShieldCheck size={12} /> {t('diag.lock.icloudSignedIn')}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-green/20 text-accent-green border border-accent-green/40 flex items-center gap-1">
                        <Unlock size={12} /> {t('diag.lock.off')}
                      </span>
                    )}
                  </div>
                  {report.security_locks.fmi_account_masked && (
                    <div className="text-[13px] text-text-muted flex items-center justify-between pt-1 border-t border-border-light">
                      <span>{t('diag.lock.appleId')}</span>
                      <span className="font-mono text-accent-purple font-semibold">{report.security_locks.fmi_account_masked}</span>
                    </div>
                  )}
                </div>

                {/* Google FRP */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-surface/50">
                  <span className="text-text-secondary">{t('diag.lock.frpLabel')}</span>
                  {report.security_locks.frp_locked ? (
                    <span className="px-2 py-0.5 rounded whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-red/20 text-accent-red border border-accent-red/40">
                      {t('diag.lock.locked')}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-green/20 text-accent-green border border-accent-green/40">
                      {t('diag.lock.off')}
                    </span>
                  )}
                </div>

                {/* Knox Warranty */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-surface/50">
                  <span className="text-text-secondary">{t('diag.lock.knoxLabel')}</span>
                  {report.security_locks.knox_tripped ? (
                    <span className="px-2 py-0.5 rounded whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-red/20 text-accent-red border border-accent-red/40">
                      {t('diag.lock.knoxTripped')}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-green/20 text-accent-green border border-accent-green/40">
                      {t('diag.lock.knoxIntact')}
                    </span>
                  )}
                </div>

                {/* Carrier / SIM Lock */}
                <div className="p-2.5 rounded-xl bg-surface/50 border border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary font-medium">{t('diag.lock.carrierLabel')}</span>
                    {report.security_locks.carrier_locked ? (
                      <span className="px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-red/20 text-accent-red border border-accent-red/40">
                        {t('diag.lock.networkLocked')}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-green/20 text-accent-green border border-accent-green/40 flex items-center gap-1">
                        <Unlock size={12} /> {t('diag.lock.factoryUnlocked')}
                      </span>
                    )}
                  </div>
                  {report.security_locks.carrier_name && (
                    <div className="text-[13px] text-text-muted flex items-center justify-between pt-1 border-t border-border-light">
                      <span>{t('diag.lock.simNetwork')}</span>
                      <span className="font-semibold text-accent-blue">{report.security_locks.carrier_name}</span>
                    </div>
                  )}
                </div>

                {/* Root / Jailbreak */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-surface/50">
                  <span className="text-text-secondary">{t('diag.lock.rootLabel')}</span>
                  {report.security_locks.is_rooted_or_jailbroken ? (
                    <span className="px-2 py-0.5 rounded whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-red/20 text-accent-red border border-accent-red/40">
                      {t('diag.lock.modified')}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded whitespace-nowrap shrink-0 text-[13px] font-semibold bg-accent-green/20 text-accent-green border border-accent-green/40">
                      {t('diag.lock.officialOs')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Grading, Parts Serialization & 28 Tests (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Master Grading Hero Card */}
            {(() => {
              const colors = getGradeColors(report.grading.grade);
              return (
                <div className="card p-6 relative overflow-hidden">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
                    <div className="flex items-center gap-5">
                      {/* Single accent ring: the score as a proportion of 100, grade in the centre */}
                      <div className={`relative w-24 h-24 flex-shrink-0 ${colors.text}`}>
                        <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90" aria-hidden="true">
                          <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="2.5" className="stroke-border-light" />
                          <circle
                            cx="18"
                            cy="18"
                            r="15.9"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeDasharray={`${Math.max(0, Math.min(100, report.grading.score))} 100`}
                            className="transition-[stroke-dasharray] duration-300"
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold tracking-tight">
                          {report.grading.grade}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="eyebrow">{t('diagnostics.grade')}</span>
                          {report.grading.provisional && (
                            <span className="badge bg-accent-blue/10 text-accent-blue">{t('diag.provisional')}</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                          <span className="text-4xl font-bold tracking-tight text-text-primary">{report.grading.score}</span>
                          <span className="text-base font-medium text-text-muted">/ 100</span>
                        </div>
                        <p className="text-[13px] text-text-secondary mt-1 max-w-md">{report.grading.summary}</p>
                      </div>
                    </div>

                    <div className="text-right border-t md:border-t-0 md:border-l border-border-light pt-3 md:pt-0 md:pl-5">
                      <div className="text-[13px] text-text-secondary">{t('diagnostics.valuation')}</div>
                      <div className="text-lg font-bold text-text-primary mt-0.5 tabular-nums">
                        {t('diag.valuation.ofBase', { percent: Math.round(report.grading.valuation_multiplier * 100) })}
                      </div>
                      <div className="text-[13px] text-text-secondary mt-0.5 tabular-nums">
                        {testsSummary}
                      </div>
                    </div>
                  </div>

                  {/* Defects Banner if any */}
                  {report.grading.defects.length > 0 ? (
                    <div className="mt-5 pt-4 border-t border-border-light">
                      <div className="text-[13px] font-semibold text-accent-orange mb-1.5 flex items-center gap-1.5">
                        <AlertTriangle size={14} />
                        {t('diagnostics.defects')} ({report.grading.defects.length})
                      </div>
                      <ul className="text-[13px] text-text-primary space-y-1 list-disc list-inside">
                        {report.grading.defects.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  ) : !report.grading.provisional ? (
                    <div className="mt-5 pt-4 border-t border-border-light text-[13px] text-accent-green flex items-center gap-1.5">
                      <Sparkles size={14} />
                      {t('diagnostics.noDefects')}
                    </div>
                  ) : null}
                  {report.grading.provisional && (
                    <div className="mt-5 pt-4 border-t border-border-light text-[13px] text-text-secondary flex items-start gap-2">
                      <Info size={14} className="mt-0.5 flex-shrink-0 text-accent-blue" />
                      <span>{t('diag.pendingTests', { count: report.grading.pending_tests ?? 0, total: report.grading.total_count })}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* OEM Parts Serialization Audit Card */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-accent-blue" />
                  <h3 className="text-sm font-bold text-text-primary">{t('diagnostics.partsAudit')}</h3>
                </div>
                <span className="text-[13px] text-text-muted">{t('diag.parts.subtitle')}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-text-muted font-semibold">
                      <th className="pb-2.5">{t('diag.table.component')}</th>
                      <th className="pb-2.5">{t('common.status')}</th>
                      <th className="pb-2.5 font-mono">{t('diag.table.readSerial')}</th>
                      <th className="pb-2.5">{t('diag.table.note')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {[
                      report.parts_audit.screen,
                      report.parts_audit.battery,
                      report.parts_audit.rear_camera,
                      report.parts_audit.front_camera,
                      report.parts_audit.biometrics,
                      report.parts_audit.logic_board,
                    ].map((item, idx) => (
                      <tr key={idx} className="hover:bg-surface/60">
                        <td className="py-2.5 font-medium text-text-primary">{item.name}</td>
                        <td className="py-2.5">{getStatusBadge(item.status)}</td>
                        <td className="py-2.5 font-mono text-text-secondary">
                          {item.read_serial ? (
                            <span className="bg-surface px-2 py-0.5 rounded text-[13px]">
                              {item.read_serial}
                            </span>
                          ) : (
                            <span className="text-text-muted">{t('diag.unreadable')}</span>
                          )}
                        </td>
                        <td className="py-2.5 text-text-muted text-[13px]">{item.note || t('diag.verifiedIntact')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 28-Point Interactive Hardware Test Suite */}
            <div className="card p-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-accent-blue" />
                    {t('diagnostics.hardwareSuite')}
                  </h3>
                  <p className="text-[13px] text-text-muted">
                    {t('diag.suite.desc')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setShowStudioModal(true)}
                    className="btn-primary text-[13px] py-2 px-3.5"
                  >
                    <Zap size={13} className="text-accent-orange" />
                    {t('diag.suite.studio')}
                  </button>
                  <button
                    onClick={handleBatchVerifySensors}
                    className="px-3 py-2 rounded-xl text-[13px] font-semibold bg-surface hover:bg-border-light text-text-primary border border-border flex items-center gap-1.5 transition-colors"
                    title={t('diag.suite.verifyUntestedToast')}
                  >
                    <ShieldCheck size={14} className="text-accent-green" />
                    {t('diag.suite.verifyUntested')}
                  </button>
                  <span className="text-[13px] font-semibold px-2.5 py-1 rounded-full bg-surface text-accent-blue border border-border">
                    {testsSummary}
                  </span>
                </div>
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {testCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors ${
                      selectedCategory === cat.id
                        ? 'bg-navy text-white'
                        : 'bg-surface text-text-secondary hover:bg-border-light'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Test Results: one row per test, status dot + icon, hairline dividers */}
              <div className="max-h-[420px] overflow-y-auto divide-y divide-border-light border-y border-border-light">
                {filteredTests.map((test) => {
                  const pending = !test.tested && !test.passed;
                  return (
                    <div key={test.key} className="flex items-center justify-between gap-4 py-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          aria-hidden="true"
                          className={`mt-2 w-2 h-2 rounded-full flex-shrink-0 ${
                            pending ? 'bg-text-muted' : test.passed ? 'bg-accent-green' : 'bg-accent-red'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
                            {pending ? (
                              <Circle className="w-4 h-4 text-text-muted flex-shrink-0" aria-hidden="true" />
                            ) : test.passed ? (
                              <CheckCircle2 className="w-4 h-4 text-accent-green flex-shrink-0" aria-hidden="true" />
                            ) : (
                              <XCircle className="w-4 h-4 text-accent-red flex-shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">{test.name}</span>
                            {pending && (
                              <span className="badge bg-surface text-text-muted flex-shrink-0">{t('diag.test.notTested')}</span>
                            )}
                          </div>
                          <div className="text-[13px] text-text-muted mt-0.5 line-clamp-2">
                            {pending
                              ? t('diag.test.expected', { details: test.details || t('diag.test.defaultDetail') })
                              : test.details || t('diag.test.defaultDetail')}
                          </div>
                        </div>
                      </div>

                      {pending ? (
                        <div className="flex flex-shrink-0 items-center gap-1.5">
                          <button
                            onClick={() => handleUpdateHardwareTest(test.key, true)}
                            className="px-3 py-1 rounded-full text-[13px] font-semibold bg-surface text-text-secondary hover:bg-accent-green/10 hover:text-accent-green transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                          >
                            {t('diagnostics.pass')}
                          </button>
                          <button
                            onClick={() => handleUpdateHardwareTest(test.key, false)}
                            className="px-3 py-1 rounded-full text-[13px] font-semibold bg-surface text-text-secondary hover:bg-accent-red/10 hover:text-accent-red transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                          >
                            {t('diagnostics.fail')}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => toggleHardwareTest(test.key, test.passed)}
                          className={`flex-shrink-0 px-3 py-1 rounded-full text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 ${
                            test.passed
                              ? 'bg-accent-green/10 text-accent-green hover:bg-accent-red/10 hover:text-accent-red'
                              : 'bg-accent-red/10 text-accent-red hover:bg-accent-green/10 hover:text-accent-green'
                          }`}
                        >
                          {test.passed ? t('diagnostics.pass') : t('diagnostics.fail')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom Technician Action Deck */}
            <div className="card p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex-1 min-w-[280px]">
                <input
                  type="text"
                  placeholder={t('diagnostics.technicianNotes')}
                  value={technicianNotes}
                  onChange={(e) => setTechnicianNotes(e.target.value)}
                  className="form-input text-[13px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={handleSaveReport}
                  className="btn-secondary text-[13px] py-2"
                >
                  <FileCheck className="w-4 h-4 text-accent-green" />
                  {t('diagnostics.saveReport')}
                </button>

                <button
                  onClick={() => setShowCertModal(true)}
                  className="btn-secondary text-[13px] py-2"
                >
                  <Printer className="w-4 h-4 text-accent-blue" />
                  {t('diagnostics.printA4')}
                </button>

                <button
                  onClick={handlePrintThermal}
                  className="btn-secondary text-[13px] py-2"
                >
                  <Printer className="w-4 h-4 text-accent-orange" />
                  {t('diagnostics.printThermal')}
                </button>

                <button
                  onClick={openVariantModal}
                  className="btn-primary"
                >
                  <PlusCircle className="w-4 h-4" />
                  {t('diagnostics.convertToVariant')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-12 text-center max-w-lg mx-auto">
          <Smartphone className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-base font-bold text-text-primary">{t('diag.empty.title')}</h3>
          <p className="text-[13px] text-text-muted mt-1 mb-6">
            {t('diag.empty.desc')}
          </p>
          <button
            onClick={() => handleProbe()}
            className="btn-primary"
          >
            {t('diag.empty.runDemo')}
          </button>
        </div>
      )}

      {/* --- QR Code Mobile Companion Modal --- */}
      {showQrModal && serverInfo && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card p-6 max-w-md w-full shadow-raised space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                <QrCode className="w-5 h-5 text-accent-blue" />
                {t('diagnostics.qrSync')}
              </h3>
              <button
                onClick={() => setShowQrModal(false)}
                aria-label={t('common.close')} className="btn-ghost h-8 w-8 p-0 rounded-lg"
              >
                ✕
              </button>
            </div>

            <p className="text-[13px] text-text-muted">{t('diagnostics.qrSyncDesc')}</p>

            <div className="flex justify-center p-4 bg-white rounded-xl">
              <img
                src={serverInfo.qr_code_data_url}
                alt={t('xfer.qrAlt')}
                className="w-56 h-56 object-contain"
              />
            </div>

            <div className="bg-surface/60 p-3 rounded-xl space-y-1.5 text-[13px]">
              <div className="flex justify-between">
                <span className="text-text-muted">{t('diag.qr.directUrl')}</span>
                <span className="font-mono text-accent-blue">{serverInfo.connect_url}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">{t('diag.qr.pin')}</span>
                <span className="font-mono text-accent-green font-bold">{serverInfo.pin}</span>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-accent-orange/30 bg-accent-orange/10 p-3 text-[13px] text-text-secondary">
              <Info size={14} className="mt-0.5 flex-shrink-0 text-accent-orange" />
              <div className="space-y-1">
                <p>{t('diag.qr.sameWifi')}</p>
                <p>{t('diag.qr.certWarning')}</p>
                {report?.brand === 'Apple' && <p>{t('diag.qr.iphoneLimits')}</p>}
              </div>
            </div>

            {lastSyncEvent && (
              <div className="p-2.5 rounded-lg bg-accent-green/10 border border-accent-green/30 text-accent-green text-[13px] flex items-center gap-2">
                <CheckCircle2 size={14} />
                <span>
                  {t('diag.qr.synced', { key: lastSyncEvent.test_key, details: lastSyncEvent.details || t('diag.qr.passed') })}
                </span>
              </div>
            )}

            <button
              onClick={() => setShowQrModal(false)}
              className="btn-secondary w-full text-[13px] py-2"
            >
              {t('diag.doneTesting')}
            </button>
          </div>
        </div>
      )}

      {/* --- Convert to Variant Modal --- */}
      {showVariantModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card p-6 max-w-lg w-full shadow-raised space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-accent-green" />
                {t('diagnostics.convertToVariant')}
              </h3>
              <button
                onClick={() => setShowVariantModal(false)}
                aria-label={t('common.close')} className="btn-ghost h-8 w-8 p-0 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-[13px]">
              <div>
                <label className="block mb-1.5 text-[13px] font-medium text-text-secondary">
                  {t('diagnostics.selectProduct')}
                </label>
                <select
                  value={selectedProductId || ''}
                  onChange={(e) => setSelectedProductId(Number(e.target.value))}
                  className="form-input"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t('diag.variant.existing', { name: p.name, count: p.variant_count })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1.5 text-[13px] font-medium text-text-secondary">{t('addProduct.variantName')}</label>
                <input
                  type="text"
                  value={variantName}
                  onChange={(e) => setVariantName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1.5 text-[13px] font-medium text-text-secondary">
                    {t('diagnostics.costPrice')}
                  </label>
                  <input
                    type="number"
                    value={variantCost}
                    onChange={(e) => setVariantCost(Number(e.target.value))}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="block mb-1.5 text-[13px] font-medium text-text-secondary">
                    {t('diagnostics.sellingPrice')}
                  </label>
                  <input
                    type="number"
                    value={variantPrice}
                    onChange={(e) => setVariantPrice(Number(e.target.value))}
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1.5 text-[13px] font-medium text-text-secondary">
                  {t('diagnostics.stockQuantity')}
                </label>
                <input
                  type="number"
                  min={1}
                  value={variantQuantity}
                  onChange={(e) => setVariantQuantity(Number(e.target.value))}
                  className="form-input"
                />
              </div>

              {report && (
                <div className="p-3 bg-surface/60 rounded-xl border border-border-light space-y-1 text-[13px] text-text-secondary">
                  <div className="font-bold text-accent-blue">{t('diag.variant.meta')}</div>
                  <div>• {t('diag.meta.model', { model: report.model })}</div>
                  <div>• {t('diag.meta.grade', { grade: report.grading.grade, score: report.grading.score })}</div>
                  <div>• {t('diag.meta.battery', { health: report.battery.health_percentage, cycles: report.battery.cycle_count })}</div>
                  <div>• {t('diag.meta.imei', { imei: report.imei1 || t('cert.na') })}</div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setShowVariantModal(false)}
                className="btn-secondary text-[13px] py-2"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConvertToVariant}
                disabled={converting}
                className="btn-primary text-[13px] py-2 px-5"
              >
                {converting ? t('reservations.creating') : t('diag.variant.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Printable A4 Certificate Modal --- */}
      {showCertModal && report && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 rounded-2xl p-8 max-w-2xl w-full shadow-raised space-y-6 max-h-[90vh] overflow-y-auto print:p-0 print:m-0">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <img src={logoUrl} alt={shopName} className="h-10 w-auto object-contain" />
                <div>
                  <h2 className="text-xl font-bold text-text-primary tracking-tight">{shopName}</h2>
                  <div className="text-[13px] font-bold text-accent-blue">
                    {t('diag.cert.title')}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[13px] text-slate-500 font-mono">
                  {savedInspection?.inspection_uuid || 'CERT-PREVIEW'}
                </div>
                <div className="text-[13px] text-slate-500">{new Date().toLocaleDateString()}</div>
              </div>
            </div>

            {/* Device & Grade Banner */}
            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <div>
                <div className="text-[13px] font-bold text-slate-500 uppercase">{report.brand}</div>
                <div className="text-lg font-bold text-slate-900">{report.model}</div>
                <div className="text-[13px] font-mono text-slate-600 mt-0.5">{t('diag.meta.imei', { imei: report.imei1 || t('cert.na') })}</div>
              </div>
              <div className="text-center bg-navy text-white px-5 py-2.5 rounded-xl">
                <div className="text-[13px] uppercase font-bold text-white/80">{t('diag.cert.finalGrade')}</div>
                <div className="text-2xl font-bold">{report.grading.grade}</div>
                <div className="text-[13px] text-white/80 tabular-nums">{t('diag.cert.score', { score: report.grading.score })}</div>
              </div>
            </div>

            {/* Specifications & Battery Table */}
            <div className="grid grid-cols-2 gap-4 text-[13px]">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div className="font-bold text-slate-800">{t('diag.cert.hwAudit')}</div>
                <div>{t('diag.cert.osVersion')} {report.os_version}</div>
                <div>{t('diag.cert.processor')} {report.cpu_architecture}</div>
                <div>{t('diag.spec.ram')} {report.ram_gb} GB</div>
                <div>
                  {t('diag.cert.totalStorage')} {Math.round(report.storage_total_bytes / (1024 * 1024 * 1024))} GB
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div className="font-bold text-slate-800">{t('diag.cert.batteryAudit')}</div>
                <div>
                  {t('diag.cert.healthCondition')} {report.battery.health_percentage}%
                  {report.battery.estimated && <span className="text-amber-700"> · {t('diag.battery.estimated')}</span>}
                </div>
                <div>{t('diag.cert.cycleCount')} {report.battery.cycle_count} {t('diag.cycles')}</div>
                <div>
                  {t('diag.cert.actualCapacity')} {report.battery.actual_capacity_mah} / {report.battery.design_capacity_mah} mAh
                </div>
                <div>{t('diag.cert.cellSupplier')} {report.battery.manufacturer || t('diag.battery.notReported')}</div>
              </div>
            </div>

            {/* Parts Originality Summary */}
            <div className="text-[13px] space-y-2">
              <div className="font-bold text-slate-800">{t('diag.cert.partsMatrix')}</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  report.parts_audit.screen,
                  report.parts_audit.battery,
                  report.parts_audit.rear_camera,
                  report.parts_audit.front_camera,
                  report.parts_audit.biometrics,
                  report.parts_audit.logic_board,
                ].map((item, i) => (
                  <div key={i} className="p-2 border border-slate-200 rounded-lg bg-slate-50">
                    <div className="font-bold text-slate-700">{item.name}</div>
                    <div
                      className={`text-[13px] font-semibold ${
                        item.status === 'original'
                          ? 'text-accent-green'
                          : item.status === 'replaced_oem'
                          ? 'text-accent-blue'
                          : 'text-accent-orange'
                      }`}
                    >
                      {statusLabel(item.status).toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Signatures */}
            <div className="flex justify-between pt-6 border-t border-slate-200 text-[13px] text-slate-500">
              <div>
                <div>{t('diag.cert.inspectedBy')}</div>
                <div className="font-mono text-slate-800 mt-4">_________________________</div>
              </div>
              <div className="text-right">
                <div>{t('diag.cert.customer')}</div>
                <div className="font-mono text-slate-800 mt-4">_________________________</div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 print:hidden">
              <button
                onClick={() => setShowCertModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-[13px] font-semibold"
              >
                {t('common.close')}
              </button>
              <button
                onClick={() => window.print()}
                className="btn-primary text-[13px] py-2 px-5"
              >
                {t('diag.cert.print')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Inspection History Drawer --- */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex justify-end">
          <div className="bg-card border-l border-border w-full max-w-md h-full p-6 shadow-raised flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                <History className="w-5 h-5 text-accent-blue" />
                {t('diagnostics.history')}
              </h3>
              <button
                onClick={() => setShowHistory(false)}
                aria-label={t('common.close')} className="btn-ghost h-8 w-8 p-0 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {historyList.length === 0 ? (
                <div className="text-center text-[13px] text-text-muted py-12">
                  {t('diagnostics.noHistory')}
                </div>
              ) : (
                historyList.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 bg-surface/60 rounded-xl border border-border hover:border-border transition-colors text-[13px] space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-text-primary">{item.model}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[13px] font-bold ${
                          getGradeColors(item.calculated_grade).badge
                        }`}
                      >
                        {item.calculated_grade}
                      </span>
                    </div>

                    <div className="text-text-muted flex justify-between text-[13px]">
                      <span>#{item.inspection_uuid}</span>
                      <span>{t('diag.history.battery', { percent: item.battery_health })}</span>
                    </div>

                    <div className="text-text-muted text-[13px]">
                      {new Date(item.created_at).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setShowHistory(false)}
              className="btn-secondary w-full text-[13px] py-2"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {/* Manual Hardware Diagnostic Testing Studio (Sound, Mic, Haptics, Camera) */}
      <ManualTestingStudio
        isOpen={showStudioModal}
        onClose={() => setShowStudioModal(false)}
        deviceId={report ? report.device_id : selectedDeviceId}
        deviceName={report ? report.model : t('diag.connectedPhone')}
        platform={report ? report.platform : 'iOS'}
        hardwareTests={report ? report.hardware_tests : {}}
        onUpdateTest={handleUpdateHardwareTest}
        companionConnected={companionConnected}
      />
    </div>
  );
}
