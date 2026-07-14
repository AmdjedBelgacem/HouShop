import type { Sale, SaleItemWithProduct, Customer } from '../lib/types';
import DocumentPrintModal from './DocumentPrintModal';

interface ShippingLabelProps {
  sale: Sale;
  items: SaleItemWithProduct[];
  customer?: Customer | null;
  onClose: () => void;
}

/**
 * Delivery / shipping label printer.
 * Uses the same Xprinter TSPL RAW pipeline as barcode labels, with larger
 * paper presets (100×150mm 4×6", 100×100mm, 80mm series).
 */
export default function ShippingLabel(props: ShippingLabelProps) {
  return <DocumentPrintModal kind="shipping" {...props} />;
}
