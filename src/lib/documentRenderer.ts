/**
 * Document renderer for delivery slips and invoices on Xprinter TSPL printers.
 *
 * Same Hybrid Direct RAW Graphics pipeline as barcode labels:
 *   canvas @ 203 DPI → threshold → 1-bit pack → Rust `print_label` (TSPL BITMAP).
 *
 * Layout is monochrome-friendly (black text on white) so thermal heads get clean
 * solid output on larger media (100×150mm shipping, 80mm invoice, etc.).
 */

import { packMonochrome, type RenderedBitmap } from './labelRenderer';

export type DocumentKind = 'shipping' | 'invoice';

export interface DocumentLineItem {
  name: string;
  variant?: string | null;
  qty: number;
  unitPrice: number;
  subtotal: number;
  warranty?: string | null;
}

export interface RenderDocumentInput {
  kind: DocumentKind;
  /** Display order/invoice id, e.g. #TXN-90001 or INV-90001. */
  docId: string;
  /** Already-formatted date string. */
  dateLabel: string;
  shopName: string;
  /** Optional logo URL (convertFileSrc or data URL) drawn top-left. */
  logoSrc?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  items: DocumentLineItem[];
  total: number;
  paymentMethod?: string | null;
  /** Footer thank-you line (invoice). */
  thankYou?: string | null;
  /** Labels (i18n) so the bitmap is language-correct. */
  labels: {
    title: string;
    shipTo?: string;
    billTo?: string;
    items: string;
    qty: string;
    price: string;
    subtotal: string;
    total: string;
    payment?: string;
    noCustomer?: string;
    warranty?: string;
  };
  widthPx: number;
  heightPx: number;
}

const fmt = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines).map(line => {
    if (ctx.measureText(line).width <= maxWidth) return line;
    let lo = 0;
    let hi = line.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(line.slice(0, mid)).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return line.slice(0, Math.max(1, lo));
  });
}

function drawHLine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, thick = 1) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, thick);
}

async function drawDocument(
  ctx: CanvasRenderingContext2D,
  input: RenderDocumentInput,
): Promise<void> {
  const { widthPx, heightPx, kind, labels } = input;
  const pad = Math.max(10, Math.round(widthPx * 0.04));
  const contentW = widthPx - pad * 2;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;

  let y = pad;

  // ── Header: logo + shop name + doc id ──────────────────────────────────
  const logoSize = Math.min(Math.round(widthPx * 0.14), 64);
  let logoDrawn = false;
  if (input.logoSrc) {
    const logo = await loadImage(input.logoSrc);
    if (logo) {
      // Contain logo in square, then thresholding makes it B&W for thermal.
      const scale = Math.min(logoSize / logo.naturalWidth, logoSize / logo.naturalHeight);
      const lw = Math.max(1, Math.round(logo.naturalWidth * scale));
      const lh = Math.max(1, Math.round(logo.naturalHeight * scale));
      ctx.drawImage(logo, pad, y, lw, lh);
      logoDrawn = true;
    }
  }

  const headerLeft = logoDrawn ? pad + logoSize + Math.round(pad * 0.5) : pad;
  const headerRightW = Math.round(contentW * 0.38);
  const headerMidW = contentW - (headerLeft - pad) - headerRightW - 4;

  const shopFont = Math.max(12, Math.round(widthPx * 0.045));
  ctx.font = `900 ${shopFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const shopLines = wrapText(ctx, input.shopName, Math.max(40, headerMidW), 2);
  let shopY = y + 2;
  for (const line of shopLines) {
    ctx.fillText(line, headerLeft, shopY);
    shopY += shopFont * 1.15;
  }

  const titleFont = Math.max(9, Math.round(widthPx * 0.028));
  ctx.font = `600 ${titleFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(labels.title, headerLeft, shopY + 2);

  // Right-aligned doc id + date
  const idFont = Math.max(10, Math.round(widthPx * 0.032));
  ctx.font = `700 ${idFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const idW = ctx.measureText(input.docId).width;
  ctx.fillText(input.docId, widthPx - pad - idW, y + 2);

  const dateFont = Math.max(8, Math.round(widthPx * 0.024));
  ctx.font = `400 ${dateFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const dateW = ctx.measureText(input.dateLabel).width;
  ctx.fillText(input.dateLabel, widthPx - pad - dateW, y + 2 + idFont * 1.3);

  y = Math.max(y + (logoDrawn ? logoSize : shopFont * 2.5), shopY + titleFont + 8) + Math.round(pad * 0.4);
  drawHLine(ctx, pad, y, contentW, 2);
  y += Math.round(pad * 0.55);

  // ── Customer block ─────────────────────────────────────────────────────
  const sectionFont = Math.max(8, Math.round(widthPx * 0.025));
  const bodyFont = Math.max(10, Math.round(widthPx * 0.032));
  const smallFont = Math.max(8, Math.round(widthPx * 0.026));

  const partyLabel = kind === 'shipping' ? (labels.shipTo ?? 'Ship To') : (labels.billTo ?? 'Bill To');
  ctx.font = `700 ${sectionFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(partyLabel.toUpperCase(), pad, y);
  y += sectionFont * 1.5;

  const hasCustomer = !!(input.customerName || input.customerPhone || input.customerAddress);
  if (hasCustomer) {
    if (input.customerName) {
      ctx.font = `800 ${bodyFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      for (const line of wrapText(ctx, input.customerName, contentW, 2)) {
        ctx.fillText(line, pad, y);
        y += bodyFont * 1.2;
      }
    }
    ctx.font = `400 ${smallFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    if (input.customerPhone) {
      ctx.fillText(input.customerPhone, pad, y);
      y += smallFont * 1.25;
    }
    if (input.customerEmail && kind === 'invoice') {
      ctx.fillText(input.customerEmail, pad, y);
      y += smallFont * 1.25;
    }
    if (input.customerAddress) {
      for (const line of wrapText(ctx, input.customerAddress, contentW, 3)) {
        ctx.fillText(line, pad, y);
        y += smallFont * 1.25;
      }
    }
  } else {
    ctx.font = `400 italic ${smallFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(labels.noCustomer ?? 'Walk-in Customer', pad, y);
    y += smallFont * 1.4;
  }

  y += Math.round(pad * 0.35);
  drawHLine(ctx, pad, y, contentW, 1);
  y += Math.round(pad * 0.45);

  // ── Items table ────────────────────────────────────────────────────────
  ctx.font = `700 ${sectionFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(labels.items.toUpperCase(), pad, y);
  y += sectionFont * 1.45;

  const colQtyW = Math.round(contentW * 0.1);
  const colPriceW = Math.round(contentW * 0.22);
  const colSubW = Math.round(contentW * 0.22);
  const colNameW = contentW - colQtyW - colPriceW - colSubW - 8;

  // Column headers
  ctx.font = `600 ${Math.max(7, sectionFont - 1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(labels.qty, pad + colNameW + 4, y);
  const priceHdr = labels.price;
  ctx.fillText(priceHdr, pad + colNameW + colQtyW + 4, y);
  const subHdr = labels.subtotal;
  const subHdrW = ctx.measureText(subHdr).width;
  ctx.fillText(subHdr, widthPx - pad - subHdrW, y);
  y += sectionFont * 1.3;
  drawHLine(ctx, pad, y, contentW, 1);
  y += 4;

  const rowFont = Math.max(9, Math.round(widthPx * 0.028));
  const rowSmall = Math.max(7, Math.round(widthPx * 0.022));
  const maxItemY = heightPx - pad - Math.round(heightPx * 0.14);

  for (const item of input.items) {
    if (y > maxItemY) {
      ctx.font = `600 ${rowSmall}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText('…', pad, y);
      y += rowSmall * 1.4;
      break;
    }

    const title = item.variant ? `${item.name} (${item.variant})` : item.name;
    ctx.font = `600 ${rowFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const nameLines = wrapText(ctx, title, colNameW, 2);
    const rowTop = y;
    for (const line of nameLines) {
      ctx.fillText(line, pad, y);
      y += rowFont * 1.15;
    }
    if (item.warranty && kind === 'invoice') {
      ctx.font = `400 ${rowSmall}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(item.warranty, pad, y);
      y += rowSmall * 1.2;
    }

    // Align qty/price/subtotal with the first name line
    ctx.font = `500 ${rowFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const qtyStr = String(item.qty);
    ctx.fillText(qtyStr, pad + colNameW + 4, rowTop);

    const unitStr = fmt(item.unitPrice);
    ctx.fillText(unitStr, pad + colNameW + colQtyW + 4, rowTop);

    const subStr = fmt(item.subtotal);
    const subW = ctx.measureText(subStr).width;
    ctx.fillText(subStr, widthPx - pad - subW, rowTop);

    y += Math.round(pad * 0.2);
  }

  y = Math.max(y + 4, maxItemY - Math.round(heightPx * 0.02));
  drawHLine(ctx, pad, y, contentW, 2);
  y += Math.round(pad * 0.4);

  // ── Totals ─────────────────────────────────────────────────────────────
  if (input.paymentMethod && kind === 'invoice' && labels.payment) {
    ctx.font = `400 ${smallFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(`${labels.payment}: ${input.paymentMethod}`, pad, y);
  }

  const totalFont = Math.max(12, Math.round(widthPx * 0.042));
  ctx.font = `900 ${totalFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const totalLabel = labels.total;
  const totalVal = fmt(input.total);
  const totalValW = ctx.measureText(totalVal).width;
  ctx.fillText(totalVal, widthPx - pad - totalValW, y);

  ctx.font = `800 ${totalFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const totalLabelW = ctx.measureText(totalLabel).width;
  ctx.fillText(totalLabel, widthPx - pad - totalValW - 10 - totalLabelW, y);

  y += totalFont * 1.5;

  if (kind === 'invoice' && input.thankYou) {
    y += Math.round(pad * 0.3);
    ctx.font = `400 italic ${smallFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (const line of wrapText(ctx, input.thankYou, contentW, 2)) {
      ctx.fillText(line, pad, y);
      y += smallFont * 1.25;
    }
  }

  // Outer border (helps registration on die-cut delivery labels)
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, widthPx - 2, heightPx - 2);
}

/**
 * Render a delivery/invoice document to a packed 1-bit bitmap for TSPL printing.
 */
export async function renderDocumentToBitmap(input: RenderDocumentInput): Promise<RenderedBitmap> {
  const { widthPx, heightPx } = input;
  if (widthPx <= 0 || heightPx <= 0) {
    throw new Error(`Invalid canvas dimensions ${widthPx}×${heightPx}`);
  }
  if (widthPx % 8 !== 0) {
    throw new Error(`Canvas width must be a multiple of 8 (got ${widthPx})`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Failed to acquire 2D canvas context');

  await drawDocument(ctx, input);
  const { packedBase64, widthBytes } = packMonochrome(ctx, widthPx, heightPx);
  return { packedBase64, widthBytes, widthPx, heightPx };
}

/** Same layout as print, returned as a PNG data URL for the modal preview. */
export async function renderDocumentToDataURL(input: RenderDocumentInput): Promise<string> {
  const { widthPx, heightPx } = input;
  const w = Math.ceil(widthPx / 8) * 8;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D canvas context');
  await drawDocument(ctx, { ...input, widthPx: w });
  return canvas.toDataURL('image/png');
}
