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

const SIZES: Record<PaperSize, { w: number; h: number; printW: number; printH: number; label: string; nameFont: string; skuFont: string; priceFont: string; barWidth: number; barHeight: number; barFont: number; showBarText: boolean }> = {
  medium: { w: 45, h: 35, printW: 42, printH: 33, label: '35×45mm', nameFont: '9px', skuFont: '6.5px', priceFont: '10px', barWidth: 1.1, barHeight: 28, barFont: 8, showBarText: true },
  small:  { w: 40, h: 20, printW: 37, printH: 18, label: '20×40mm', nameFont: '6.5px', skuFont: '5px', priceFont: '7px', barWidth: 0.9, barHeight: 14, barFont: 6, showBarText: false },
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
          format: 'EAN13',
          width: s.barWidth,
          height: s.barHeight,
          displayValue: s.showBarText,
          fontSize: s.barFont,
          margin: 0,
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
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body {
            width: ${s.w}mm !important;
            height: ${s.h}mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }
          body * { visibility: hidden !important; }
          .barcode-print-area, .barcode-print-area * { visibility: visible !important; }
          .barcode-print-area {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: ${s.printW}mm !important;
            height: ${s.printH}mm !important;
            margin: 1mm !important;
            background: white !important;
            color: #000 !important;
            text-align: center !important;
            overflow: hidden !important;
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

        <div className="barcode-print-area">
          <p style={{ fontSize: s.nameFont, fontWeight: 900, lineHeight: 1.1, margin: 0 }} className="text-text-primary">{productName}</p>
          {sku && <p style={{ fontSize: s.skuFont, margin: '0.3mm 0 0 0' }} className="text-text-muted">SKU: {sku}</p>}
          {price != null && price > 0 && (
            <p style={{ fontSize: s.priceFont, fontWeight: 900, margin: '0.3mm 0 0 0' }} className="text-navy">{fmt(price)}</p>
          )}
          <div style={{ marginTop: '0.5mm' }}>
            <svg ref={svgRef} style={{ maxWidth: `${s.printW - 2}mm`, display: 'block' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
