import type { Sale, SaleItemWithProduct, Customer } from '../lib/types';
import DocumentPrintModal from './DocumentPrintModal';

interface InvoiceProps {
  sale: Sale;
  items: SaleItemWithProduct[];
  customer?: Customer | null;
  onClose: () => void;
}

/**
 * Invoice printer via Xprinter TSPL RAW (same mechanism as barcode labels),
 * with larger thermal paper presets suitable for receipts / delivery docs.
 */
export default function Invoice(props: InvoiceProps) {
  return <DocumentPrintModal kind="invoice" {...props} />;
}
