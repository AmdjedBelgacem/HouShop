import { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { useI18n } from '../i18n';
import { X, Printer, AlertTriangle } from 'lucide-react';

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

// Medium: unrotated. Barcode footprint:
//   width = 95 * 1.1 * 0.2646 + 2*(6*0.2646) = 27.6 + 3.2 = ~31mm -> along 45mm axis (fits)
//   barHeight 50px * 0.2646 = 13.2mm + 2*(6*0.2646) margin = ~16.4mm -> height on 35mm axis (fits with text above)
// Small: unrotated. Barcode footprint:
//   width ~31mm -> along 40mm axis (fits)
//   barHeight 50px * 0.2646 = 13.2mm + top(2)+bottom(2) margin = ~14.3mm -> height on 20mm axis (fits with text above)
const SIZES: Record<PaperSize, { w: number; h: number; label: string; nameFont: string; skuFont: string; priceFont: string; barWidth: number; barHeight: number; barFont: number; showBarText: boolean }> = {
  medium: { w: 45, h: 35, label: '35×45mm', nameFont: '9px', skuFont: '6.5px', priceFont: '10px', barWidth: 1.1, barHeight: 50, barFont: 9, showBarText: true },
  small:  { w: 40, h: 20, label: '20×40mm', nameFont: '6.5px', skuFont: '5px', priceFont: '7px', barWidth: 1.1, barHeight: 50, barFont: 7, showBarText: false },
};

function isValidEan13Input(value: string): boolean {
  return /^\d{12,13}$/.test(value);
}

export default function BarcodePrintModal({ barcode, productName, sku, price, onClose }: BarcodePrintModalProps) {
  const { t } = useI18n();
  const [paper, setPaper] = useState<PaperSize>('medium');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const s = SIZES[paper];

  useEffect(() => {
    if (!svgRef.current) return;

    if (!barcode || !isValidEan13Input(barcode)) {
      setBarcodeError(`Invalid barcode: "${barcode}". Must be 12-13 digits.`);
      svgRef.current.innerHTML = '';
      return;
    }

    setBarcodeError(null);
    try {
      const marginOpts = paper === 'small'
        ? { marginTop: 2, marginBottom: 2, marginLeft: 6, marginRight: 6 }
        : { margin: 6 };
      JsBarcode(svgRef.current, barcode, {
        format: 'EAN13',
        width: s.barWidth,
        height: s.barHeight,
        displayValue: s.showBarText,
        fontSize: s.barFont,
        ...marginOpts,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown barcode error';
      setBarcodeError(msg);
      if (svgRef.current) svgRef.current.innerHTML = '';
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
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: ${s.w}mm !important;
            height: ${s.h}mm !important;
            background: white !important;
            color: #000 !important;
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

        {barcodeError && (
          <div className="barcode-no-print flex items-center gap-2 mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-accent-red flex-shrink-0" />
            <p className="text-[11px] text-accent-red font-medium">{barcodeError}</p>
          </div>
        )}

        <div className="barcode-print-area" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: `${s.h}mm` }}>
          <p style={{ fontSize: s.nameFont, fontWeight: 900, lineHeight: 1.1, margin: 0, textAlign: 'center', width: '100%', maxWidth: `${s.w}mm`, wordBreak: 'break-word' }} className="text-text-primary">{productName}</p>
          <div style={{ display: 'flex', gap: '2mm', alignItems: 'center' }}>
            {sku && <p style={{ fontSize: s.skuFont, margin: 0 }} className="text-text-muted">SKU: {sku}</p>}
            {price != null && price > 0 && (
              <p style={{ fontSize: s.priceFont, fontWeight: 900, margin: 0 }} className="text-navy">{fmt(price)}</p>
            )}
          </div>
          <div style={{ marginTop: '0.5mm', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
            <svg ref={svgRef} style={{ display: 'block' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
