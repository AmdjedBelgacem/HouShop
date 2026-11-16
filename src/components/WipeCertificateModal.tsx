import React, { useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ShieldCheck,
  Printer,
  X,
  Smartphone,
  CheckCircle2,
  FileCheck2,
  Tag,
} from 'lucide-react';
import type { SanitizationRecord } from '../lib/types';
import { toast } from 'sonner';
import { useI18n } from '../i18n';

interface WipeCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: SanitizationRecord | null;
  shopName?: string;
  shopLogoUrl?: string | null;
}

export const WipeCertificateModal: React.FC<WipeCertificateModalProps> = ({
  isOpen,
  onClose,
  record,
  shopName = 'HouShop',
  shopLogoUrl,
}) => {
  const printRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  // Split sentences around their bold standard name so the name keeps its own markup
  const [introBefore, introAfter] = t('cert.intro').split('{std}');
  const [legalBefore, legalAfter] = t('cert.legal.text').split('{std}');

  if (!isOpen || !record) return null;

  const handlePrintA4 = () => {
    window.print();
  };

  const handlePrintTsplLabel = async () => {
    try {
      await invoke('print_wipe_label', {
        recordId: record.id,
      });
      toast.success(t('cert.toast.labelSent'));
    } catch (e) {
      toast.error(t('cert.toast.labelFailed', { error: String(e) }));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/30 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('cert.dialogLabel')}
        className="relative w-full max-w-4xl bg-card border border-border rounded-2xl shadow-raised overflow-hidden flex flex-col my-8"
      >
        {/* Top Control Bar (Hidden when printing) */}
        <div className="no-print flex items-center justify-between gap-4 px-6 py-4 border-b border-border-light">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-accent-green/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-accent-green" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-text-primary">
                  {t('cert.title')}
                </h3>
                <span className="badge border border-accent-green/30 bg-accent-green/10 text-accent-green font-mono">
                  {record.certificate_number}
                </span>
              </div>
              <p className="text-[13px] text-text-secondary mt-0.5">
                {t('cert.standardLine')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('cert.closeAria')}
            title={t('common.close')}
            className="btn-ghost w-8 h-8 p-0 rounded-xl shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* The Printable A4 Certificate Canvas */}
        <div
          ref={printRef}
          className="certificate-print-root p-8 sm:p-12 bg-white text-slate-900 font-sans selection:bg-emerald-100 overflow-y-auto max-h-[78vh]"
        >
          {/* Certificate Header */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-6 mb-6">
            <div className="flex items-center gap-4">
              {shopLogoUrl ? (
                <img
                  src={shopLogoUrl}
                  alt={shopName}
                  className="w-16 h-16 object-contain rounded-xl border border-slate-200 p-1"
                />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-accent-green text-white flex items-center justify-center font-bold text-2xl shadow-md">
                  {shopName.charAt(0)}
                </div>
              )}
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  {shopName.toUpperCase()}
                </h1>
                <p className="text-[13px] uppercase tracking-wide font-bold text-slate-500">
                  {t('cert.shopTagline')}
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="inline-block px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg text-[13px] font-bold uppercase tracking-wider mb-1">
                {t('cert.nistBadge')}
              </span>
              <div className="font-mono text-[13px] font-bold text-slate-700">
                {t('cert.certNo')} <span className="text-slate-950 font-bold">{record.certificate_number}</span>
              </div>
              <div className="text-[13px] text-slate-500">
                {t('cert.issueDate', { date: new Date(record.created_at).toLocaleDateString() })}
              </div>
            </div>
          </div>

          {/* Certificate Title */}
          <div className="text-center my-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-950 tracking-tight uppercase">
              {t('cert.heading')}
            </h2>
            <p className="text-[13px] sm:text-sm text-slate-600 mt-1 max-w-2xl mx-auto">
              {introBefore}<b>{t('cert.std')}</b>{introAfter}
            </p>
          </div>

          {/* Device & Sanitization Data Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-6">
            {/* Box 1: Verified Device Identity */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                <Smartphone className="w-4 h-4 text-accent-green" />
                <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-900">
                  {t('cert.device.section')}
                </h3>
              </div>
              <dl className="grid grid-cols-3 gap-y-2.5 text-[13px]">
                <dt className="text-slate-500 font-medium">{t('cert.device.brandModel')}</dt>
                <dd className="col-span-2 font-bold text-slate-900">
                  {record.brand} {record.model}
                </dd>

                <dt className="text-slate-500 font-medium">{t('cert.device.platform')}</dt>
                <dd className="col-span-2 font-bold text-slate-900">
                  {record.platform} ({record.os_version})
                </dd>

                <dt className="text-slate-500 font-medium">{t('cert.device.imei')}</dt>
                <dd className="col-span-2 font-mono font-bold text-slate-900">
                  {record.imei || t('cert.naWifi')}
                </dd>

                {record.imei2 && (
                  <>
                    <dt className="text-slate-500 font-medium">{t('cert.device.imei2')}</dt>
                    <dd className="col-span-2 font-mono font-bold text-slate-900">
                      {record.imei2}
                    </dd>
                  </>
                )}

                <dt className="text-slate-500 font-medium">{t('cert.device.serial')}</dt>
                <dd className="col-span-2 font-mono font-bold text-slate-900">
                  {record.serial_number || t('cert.na')}
                </dd>

                <dt className="text-slate-500 font-medium">{t('cert.device.storage')}</dt>
                <dd className="col-span-2 font-bold text-slate-900">
                  {record.storage_capacity || t('cert.na')}
                </dd>
              </dl>
            </div>

            {/* Box 2: Sanitization Execution Audit */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                <ShieldCheck className="w-4 h-4 text-accent-green" />
                <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-900">
                  {t('cert.protocol.section')}
                </h3>
              </div>
              <dl className="grid grid-cols-3 gap-y-2.5 text-[13px]">
                <dt className="text-slate-500 font-medium">{t('cert.protocol.method')}</dt>
                <dd className="col-span-2 font-bold text-slate-900">
                  {record.wipe_method}
                </dd>

                <dt className="text-slate-500 font-medium">{t('cert.protocol.standard')}</dt>
                <dd className="col-span-2 font-bold text-emerald-700">
                  {record.nist_standard}
                </dd>

                <dt className="text-slate-500 font-medium">{t('cert.protocol.lockAudit')}</dt>
                <dd className="col-span-2 font-bold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-accent-green" />
                  {t('cert.protocol.lockValue')}
                </dd>

                <dt className="text-slate-500 font-medium">{t('cert.protocol.oobe')}</dt>
                <dd className="col-span-2 font-bold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-accent-green" />
                  {t('cert.protocol.oobeValue')}
                </dd>

                <dt className="text-slate-500 font-medium">{t('cert.protocol.uuid')}</dt>
                <dd className="col-span-2 font-mono text-[13px] text-slate-600">
                  {record.wipe_uuid}
                </dd>

                <dt className="text-slate-500 font-medium">{t('cert.protocol.duration')}</dt>
                <dd className="col-span-2 font-bold text-slate-900">
                  {t('cert.protocol.seconds', { seconds: record.duration_seconds })}
                </dd>
              </dl>
            </div>
          </div>

          {/* Legal Compliance Statement */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-[13px] text-slate-600 leading-relaxed my-6">
            <h4 className="font-bold text-slate-900 mb-1 flex items-center gap-1.5">
              <FileCheck2 size={14} className="text-accent-green" />
              {t('cert.legal.title')}
            </h4>
            <p>
              {legalBefore}<b>{t('cert.legal.std')}</b>{legalAfter}
            </p>
          </div>

          {/* Signatures & Handover Block */}
          <div className="grid grid-cols-2 gap-8 pt-6 mt-8 border-t-2 border-slate-200 text-[13px]">
            <div>
              <div className="font-bold text-slate-900 mb-1">{t('cert.signature.tech')}</div>
              <div className="text-slate-700 font-medium">{record.technician_name}</div>
              <div className="h-14 border-b border-dashed border-slate-300 mt-2"></div>
              <div className="text-[13px] text-slate-500 mt-1">{t('cert.signature.techLine')}</div>
            </div>

            <div>
              <div className="font-bold text-slate-900 mb-1">{t('cert.signature.handover')}</div>
              <div className="text-slate-700 font-medium">{t('cert.signature.accepted')}</div>
              <div className="h-14 border-b border-dashed border-slate-300 mt-2"></div>
              <div className="text-[13px] text-slate-500 mt-1">{t('cert.signature.customer')}</div>
            </div>
          </div>

          {/* Footer Barcode & Timestamp */}
          <div className="mt-8 pt-4 border-t border-slate-200 flex items-center justify-between text-[13px] text-slate-500">
            <div>
              {t('cert.footer.system', { code: record.certificate_number })}
            </div>
            <div>
              {t('cert.footer.generated', { date: new Date(record.created_at).toLocaleString() })}
            </div>
          </div>
        </div>

        {/* Modal Footer (Hidden when printing) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-border-light">
          <div className="text-[13px] text-text-secondary flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-accent-green shrink-0" />
            <span>{t('cert.storedNote')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-[13px]">
              {t('cert.done')}
            </button>
            <button
              type="button"
              onClick={handlePrintTsplLabel}
              title={t('cert.labelTitle')}
              className="btn-secondary px-4 py-2 text-[13px]"
            >
              <Tag size={14} className="text-accent-orange" />
              {t('cert.labelButton')}
            </button>
            <button type="button" onClick={handlePrintA4} className="btn-primary px-4 py-2 text-[13px]">
              <Printer size={14} />
              {t('cert.printA4')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
