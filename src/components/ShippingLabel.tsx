import { useI18n } from '../i18n';
import type { Sale, SaleItemWithProduct, Customer } from '../lib/types';
import { X, Printer } from 'lucide-react';
import logo from '../assets/logo.png';

interface ShippingLabelProps {
  sale: Sale;
  items: SaleItemWithProduct[];
  customer?: Customer | null;
  onClose: () => void;
}

const fmt = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function ShippingLabel({ sale, items, customer, onClose }: ShippingLabelProps) {
  const { t } = useI18n();
  const orderId = `#TXN-${90000 + sale.id}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onClick={onClose}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .shipping-print-area, .shipping-print-area * { visibility: visible !important; }
          .shipping-print-area {
            position: absolute !important;
            left: 0 !important; top: 0 !important;
            width: 80mm !important;
            background: white !important;
            color: #000 !important;
            padding: 4mm !important;
            font-size: 11px !important;
          }
          .shipping-no-print { display: none !important; }
        }
      `}</style>

      <div
        className="bg-card rounded-2xl w-full max-w-[500px] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="shipping-no-print flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-[14px] font-bold text-text-primary">{t('shipping.title')}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-[12px] font-medium hover:bg-navy-light transition-colors">
              <Printer size={13} /> {t('shipping.printLabel')}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface text-text-muted transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="shipping-print-area flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-3 mb-5">
            <img src={logo} alt="Logo" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="text-[18px] font-black text-text-primary">HouShop</h1>
              <p className="text-[10px] text-text-muted">{t('shipping.title')}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[12px] font-bold text-navy">{orderId}</p>
              <p className="text-[10px] text-text-muted">{formatDate(sale.created_at)}</p>
            </div>
          </div>

          <div className="mb-4 p-3 rounded-xl bg-surface border border-border">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-1">{t('shipping.shipTo')}</p>
            {customer ? (
              <>
                <p className="text-[13px] font-bold text-text-primary">{customer.name}</p>
                {customer.phone && <p className="text-[11px] text-text-secondary">{customer.phone}</p>}
                {customer.address && <p className="text-[11px] text-text-secondary">{customer.address}</p>}
              </>
            ) : (
              <p className="text-[12px] text-text-muted italic">{t('shipping.noCustomer')}</p>
            )}
          </div>

          <table className="w-full text-[11px] border-collapse mb-4">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="text-left py-2 text-text-muted font-semibold">{t('shipping.items')}</th>
                <th className="text-center py-2 text-text-muted font-semibold">{t('invoice.qty')}</th>
                <th className="text-right py-2 text-text-muted font-semibold">{t('invoice.unitPrice')}</th>
                <th className="text-right py-2 text-text-muted font-semibold">{t('invoice.subtotal')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-border-light">
                  <td className="py-2 text-text-primary font-medium">
                    {item.product_name}
                    {item.variant_name && <span className="text-text-muted"> ({item.variant_name})</span>}
                  </td>
                  <td className="py-2 text-center text-text-secondary">{item.quantity}</td>
                  <td className="py-2 text-right text-text-secondary">{fmt(item.unit_price)}</td>
                  <td className="py-2 text-right font-semibold text-text-primary">{fmt(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-[200px]">
              <div className="flex justify-between pt-2 border-t-2 border-border">
                <span className="text-[13px] font-black text-text-primary">{t('invoice.total')}</span>
                <span className="text-[13px] font-black text-navy">{fmt(sale.total_amount)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
