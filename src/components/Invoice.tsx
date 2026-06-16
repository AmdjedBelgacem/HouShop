import { useI18n } from '../i18n';
import type { Sale, SaleItemWithProduct, Customer } from '../lib/types';
import { X, Printer } from 'lucide-react';
import logo from '../assets/logo.png';
interface InvoiceProps {
  sale: Sale;
  items: SaleItemWithProduct[];
  customer?: Customer | null;
  onClose: () => void;
}
const fmt = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  }) + ' — ' + d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}
function parseWarranty(notes: string | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!notes) return map;
  try {
    const parsed = JSON.parse(notes);
    if (parsed.warranty && Array.isArray(parsed.warranty)) {
      parsed.warranty.forEach((w: { product_id: number; variant_name?: string | null; warranty_months: number }) => {
        const key = `${w.product_id}-${w.variant_name ?? 'base'}`;
        map.set(key, w.warranty_months);
      });
    }
  } catch {  }
  return map;
}
export default function Invoice({ sale, items, customer, onClose }: InvoiceProps) {
  const { t } = useI18n();
  const warrantyMap = parseWarranty(sale.notes);
  const invoiceId = `INV-${90000 + sale.id}`;
  const handlePrint = () => {
    window.print();
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onClick={onClose}>
      {}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .invoice-print-area, .invoice-print-area * { visibility: visible !important; }
          .invoice-print-area {
            position: absolute !important;
            left: 0 !important; top: 0 !important;
            width: 100% !important;
            background: white !important;
            color: #1a1a1a !important;
            padding: 40px !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .invoice-no-print { display: none !important; }
        }
      `}</style>
      <div
        className="bg-card rounded-2xl w-full max-w-[680px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {}
        <div className="invoice-no-print flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-[14px] font-bold text-text-primary">{t('invoice.title')} #{invoiceId}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-[12px] font-medium hover:bg-navy-light transition-colors"
            >
              <Printer size={13} /> {t('checkout.printInvoice')}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface text-text-muted transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
        {}
        <div className="invoice-print-area flex-1 overflow-y-auto px-8 py-7">
          {}
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-4">
              <img src={logo} alt="Logo" className="w-16 h-16 object-contain" />
              <div>
                <h1 className="text-[22px] font-black tracking-tight text-text-primary">HouShop</h1>
                <p className="text-[11px] text-text-muted mt-0.5">Professional Invoice</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">{t('invoice.title')}</p>
              <p className="text-[14px] font-bold text-navy mt-0.5">{invoiceId}</p>
              <p className="text-[11px] text-text-secondary mt-1">{formatDate(sale.created_at)}</p>
            </div>
          </div>
          {}
          {customer && (
            <div className="mb-6 p-4 rounded-xl bg-surface border border-border">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-1.5">{t('invoice.billTo')}</p>
              <p className="text-[14px] font-bold text-text-primary">{customer.name}</p>
              {customer.phone && <p className="text-[12px] text-text-secondary mt-0.5">{customer.phone}</p>}
              {customer.email && <p className="text-[12px] text-text-secondary">{customer.email}</p>}
              {customer.address && <p className="text-[12px] text-text-secondary">{customer.address}</p>}
            </div>
          )}
          {}
          <div className="mb-6">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="text-left py-2.5 text-text-muted font-semibold text-[10px] uppercase tracking-wider">{t('invoice.product')}</th>
                  <th className="text-left py-2.5 text-text-muted font-semibold text-[10px] uppercase tracking-wider">{t('invoice.variant')}</th>
                  <th className="text-center py-2.5 text-text-muted font-semibold text-[10px] uppercase tracking-wider">{t('invoice.qty')}</th>
                  <th className="text-right py-2.5 text-text-muted font-semibold text-[10px] uppercase tracking-wider">{t('invoice.unitPrice')}</th>
                  <th className="text-right py-2.5 text-text-muted font-semibold text-[10px] uppercase tracking-wider">{t('invoice.subtotal')}</th>
                  <th className="text-right py-2.5 text-text-muted font-semibold text-[10px] uppercase tracking-wider">{t('invoice.warranty')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const wKey = `${item.product_id}-${item.variant_name ?? 'base'}`;
                  const wMonths = warrantyMap.get(wKey);
                  return (
                    <tr key={idx} className="border-b border-border-light">
                      <td className="py-2.5 text-text-primary font-medium">{item.product_name}</td>
                      <td className="py-2.5 text-text-secondary">{item.variant_name ?? '—'}</td>
                      <td className="py-2.5 text-center text-text-secondary">{item.quantity}</td>
                      <td className="py-2.5 text-right text-text-secondary">{fmt(item.unit_price)}</td>
                      <td className="py-2.5 text-right font-semibold text-text-primary">{fmt(item.subtotal)}</td>
                      <td className="py-2.5 text-right text-text-secondary">
                        {wMonths ? t('invoice.warrantyMonths', { count: wMonths }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {}
          <div className="flex justify-end mb-8">
            <div className="w-[240px] space-y-2">
              <div className="flex justify-between text-[12px]">
                <span className="text-text-secondary">{t('invoice.paymentMethod')}</span>
                <span className="font-medium text-text-primary capitalize">{sale.payment_method}</span>
              </div>
              <div className="flex justify-between pt-2 border-t-2 border-border">
                <span className="text-[16px] font-black text-text-primary">{t('invoice.total')}</span>
                <span className="text-[16px] font-black text-navy">{fmt(sale.total_amount)}</span>
              </div>
            </div>
          </div>
          {}
          <div className="mt-8 pt-6 border-t border-border flex items-end justify-between">
            <p className="text-[12px] text-text-muted italic">{t('invoice.thankYou')}</p>
            <div className="text-center">
              <div className="w-[180px] border-b border-text-muted mb-1.5" style={{ height: '40px' }}></div>
              <p className="text-[10px] text-text-muted uppercase tracking-widest">{t('invoice.authorizedSignature')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
