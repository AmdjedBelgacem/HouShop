import { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { useI18n } from '../i18n';
import { X, Printer } from 'lucide-react';

type PaperSize = 'medium' | 'small';

interface BarcodePrintModalProps {
  barcode: string;
  productName: string;
  sku: string | null;
  price?: number | null;
  onClose: () => void;
}

const fmt = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;

const SIZES: Record<PaperSize, { w: number; h: number; label: string; nameFont: string; skuFont: string; priceFont: string; barWidth: number; barHeight: number; barFont: number; showBarText: boolean; padding: string }> = {
  medium: { w: 45, h: 35, label: '35×45mm', nameFont: '10px', skuFont: '7px', priceFont: '11px', barWidth: 1.5, barHeight: 38, barFont: 10, showBarText: true, padding: '2mm' },
  small:  { w: 40, h: 20, label: '20×40mm', nameFont: '7px', skuFont: '5.5px', priceFont: '8px', barWidth: 1, barHeight: 22, barFont: 7, showBarText: false, padding: '1mm' },
};

export default function BarcodePrintModal({ barcode, productName, sku, price, onClose }: BarcodePrintModalProps) {
  const { t } = useI18n();
  const [paper, setPaper] = useState<PaperSize>('medium');
  const svgRef = useRef<SVGSVGElement>(null);
  const s = SIZES[paper];

  useEffect(() => {
    if (svgRef.current && barcode) {
      try {
        JsBarcode(svgRef.current, barcode, {
          format: 'CODE128',
          width: s.barWidth,
          height: s.barHeight,
          displayValue: s.showBarText,
          fontSize: s.barFont,
          margin: 1,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch { }
    }
  }, [barcode, paper]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onClick={onClose}>
      <style>{`
        @page {
          size: ${s.w}mm ${s.h}mm;
          margin: 0;
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
          }
          body * { visibility: hidden !important; }
          .barcode-print-area, .barcode-print-area * { visibility: visible !important; }
          .barcode-print-area {
            position: absolute !important;
            left: 0 !important; top: 0 !important;
            width: ${s.w}mm !important;
            height: ${s.h}mm !important;
            background: white !important;
            color: #000 !important;
            padding: ${s.padding} !important;
            text-align: center !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
          }
          .barcode-no-print { display: none !important; }
        }
      `}</style>

      <div
        className="bg-card rounded-2xl w-full max-w-[400px] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="barcode-no-print flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-[14px] font-bold text-text-primary">{t('barcode.title')}</h3>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-surface rounded-lg border border-border p-0.5">
              {(Object.keys(SIZES) as PaperSize[]).map(key => (
                <button key={key} onClick={() => setPaper(key)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    paper === key ? 'bg-navy text-white' : 'text-text-secondary hover:bg-card'
                  }`}>
                  {SIZES[key].label}
                </button>
              ))}
            </div>
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-[12px] font-medium hover:bg-navy-light transition-colors">
              <Printer size={13} /> {t('barcode.print')}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface text-text-muted transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="barcode-print-area px-4 py-3">
          <p style={{ fontSize: s.nameFont, fontWeight: 900, lineHeight: 1.1 }} className="text-text-primary">{productName}</p>
          {sku && <p style={{ fontSize: s.skuFont, marginTop: '0.5mm' }} className="text-text-muted">SKU: {sku}</p>}
          {price != null && price > 0 && (
            <p style={{ fontSize: s.priceFont, fontWeight: 900, marginTop: '0.5mm' }} className="text-navy">{fmt(price)}</p>
          )}
          <div className="flex justify-center mt-1">
            <svg ref={svgRef} style={{ maxWidth: `${s.w - 4}mm` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
