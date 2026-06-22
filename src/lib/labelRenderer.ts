/**
 * Label renderer: composes the barcode label onto a 1-bit monochromatic canvas
 * and packs the pixel data into a byte stream the Rust `print_label` command
 * expects (row-major, MSB-first, byte-aligned rows).
 *
 * Pipeline (Hybrid Direct RAW Graphics):
 *   1. Draw to an offscreen <canvas> at the printer's native DPI.
 *   2. Threshold every pixel against 128 → pure black or white (no AA, no dither).
 *   3. Pack 8 horizontal pixels into one byte, MSB first, pad rows to a byte.
 *
 * The packed bytes are base64-encoded and forwarded to Rust, which wraps them
 * in TSPL `BITMAP` commands and injects them via the Windows Spooler (RAW).
 */

import JsBarcode from 'jsbarcode';

export interface RenderLabelInput {
  barcode: string;
  productName: string;
  sku: string | null;
  price?: number | null;
  /** Canvas width in printer dots (e.g. 280 for 35mm @ 203 DPI). Must be a multiple of 8. */
  widthPx: number;
  /** Canvas height in printer dots (e.g. 360 for 45mm @ 203 DPI). */
  heightPx: number;
}

export interface RenderedBitmap {
  /** Base64-encoded packed 1-bit pixel data. */
  packedBase64: string;
  /** Bytes per row (== widthPx / 8). Forwarded to TSPL `BITMAP`. */
  widthBytes: number;
  /** Pixel width as drawn (echoed for the TSPL payload). */
  widthPx: number;
  /** Pixel height as drawn. */
  heightPx: number;
}

const fmt = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;

/**
 * Word-wrap a string to fit `maxWidthPx` for the given font, breaking only on
 * spaces. Lines that still overflow are hard-cut.
 */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidthPx || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // Hard-cut any overflowing tail line.
  return lines.slice(0, maxLines).map(line => {
    if (ctx.measureText(line).width <= maxWidthPx) return line;
    let lo = 0;
    let hi = line.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(line.slice(0, mid)).width <= maxWidthPx) lo = mid;
      else hi = mid - 1;
    }
    return line.slice(0, lo);
  });
}

/** Pick a font size (px) so the name fills the available width without overflowing. */
function fitNameFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  maxHeightPx: number,
  maxLines: number,
): { fontPx: number; lines: string[] } {
  // Start near the design size and shrink until it fits.
  let fontPx = Math.floor(maxHeightPx / maxLines / 1.15);
  for (; fontPx >= 6; fontPx -= 1) {
    ctx.font = `900 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const lines = wrapLines(ctx, text, maxWidthPx, maxLines);
    const totalHeight = lines.length * fontPx * 1.15;
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    if (totalHeight <= maxHeightPx && widest <= maxWidthPx) {
      return { fontPx, lines };
    }
  }
  ctx.font = `900 6px system-ui, -apple-system, "Segoe UI", sans-serif`;
  return { fontPx: 6, lines: wrapLines(ctx, text, maxWidthPx, maxLines) };
}

/**
 * Render the EAN-13 barcode into its own offscreen canvas via JsBarcode.
 * Returns null if the barcode is invalid (caller handles).
 */
function renderBarcodeCanvas(
  barcode: string,
  widthPx: number,
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, barcode, {
      format: 'EAN13',
      // Module width in printer dots. 95 modules + 2×6 quiet = ~107 modules
      // of usable width; choose so the full barcode fits within `widthPx`
      // while keeping modules on whole-pixel boundaries for crisp edges.
      width: Math.max(1, Math.floor(widthPx / 115)),
      height: 70,
      displayValue: true,
      fontSize: 16,
      margin: 0,
      background: '#ffffff',
      lineColor: '#000000',
    });
  } catch {
    return null;
  }
  return canvas;
}

/**
 * Threshold-and-pack a canvas into a base64 1-bit byte string.
 *
 * Bit polarity: TSPL `BITMAP` defines bit `1` = black (print) and `0` = white
 * (no print), MSB-first within each byte. This Xprinter prints the *inverse*
 * (white content on a black background) with the spec polarity, so we invert:
 * a dark source pixel → 0 in the packed byte. Toggling `DIRECTION` in the UI
 * can also flip this, but inverting at pack time is the reliable default.
 */
function packMonochrome(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
): { packedBase64: string; widthBytes: number } {
  const { data } = ctx.getImageData(0, 0, widthPx, heightPx);
  const widthBytes = Math.ceil(widthPx / 8);
  const out = new Uint8Array(widthBytes * heightPx);

  for (let y = 0; y < heightPx; y++) {
    for (let bx = 0; bx < widthBytes; bx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit;
        let black = false;
        if (x < widthPx) {
          const i = (y * widthPx + x) * 4;
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
          // Hard threshold: < 128 → black source pixel.
          black = lum < 128;
        }
        // MSB = leftmost pixel. Invert so black → 0 (matches this printer's
        // polarity). Padding bits at row end → 1 (no print).
        byte = (byte << 1) | (black ? 0 : 1);
      }
      out[y * widthBytes + bx] = byte;
    }
  }

  return { packedBase64: uint8ToBase64(out), widthBytes };
}

/** Base64-encode a Uint8Array without chunk-size limits. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Compose the label and return its packed 1-bit bitmap.
 * Throws on invalid barcode / invalid dimensions.
 */
export function renderLabelToBitmap(input: RenderLabelInput): RenderedBitmap {
  const { barcode, productName, sku, price, widthPx, heightPx } = input;
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

  // --- Step 1a: white background, crisp settings ---------------------------
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;

  const padX = Math.max(4, Math.round(widthPx * 0.04));
  const nameMaxWidth = widthPx - padX * 2;

  // --- PASS 1: measure all content heights so we can center vertically ---
  const priceText = price != null && price > 0 ? fmt(price) : '';
  const skuText = sku ? `SKU: ${sku}` : '';
  const rowGap = Math.round(widthPx * 0.025);
  // Bumped font scales for legibility on small labels.
  const skuFont = Math.max(8, Math.round(widthPx * 0.055));
  const priceFont = Math.max(10, Math.round(widthPx * 0.075));

  const { fontPx: nameFont, lines: nameLines } = fitNameFont(
    ctx,
    productName || '',
    nameMaxWidth,
    Math.round(heightPx * 0.30),
    2,
  );
  const nameLineHeight = nameFont * 1.12;
  const nameBlockH = nameLines.length * nameLineHeight;

  ctx.font = `900 ${priceFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const priceRowH = priceText || skuText ? priceFont * 1.25 : 0;

  const barCanvas = renderBarcodeCanvas(barcode, widthPx);
  const barBlockH = barCanvas
    ? Math.floor(barCanvas.height * Math.min((widthPx - padX * 2) / barCanvas.width))
    : 0;

  // Small inter-block spacing: tight so content groups, but non-zero for readability.
  const gapNamePrice = Math.round(heightPx * 0.015);
  const gapPriceBar = Math.round(heightPx * 0.02);
  const totalContentH =
    nameBlockH + (priceRowH ? gapNamePrice + priceRowH : 0) + (barBlockH ? gapPriceBar + barBlockH : 0);

  // Vertical center offset. Floor so we don't blur rows across dot boundaries.
  let cursorY = Math.max(padX, Math.floor((heightPx - totalContentH) / 2));

  // --- PASS 2: draw name (centered) --------------------------------------
  ctx.font = `900 ${nameFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  for (const line of nameLines) {
    ctx.fillText(line, (widthPx - ctx.measureText(line).width) / 2, cursorY);
    cursorY += nameLineHeight;
  }

  // --- PASS 2: SKU + price row (centered) --------------------------------
  if (priceRowH) {
    cursorY += gapNamePrice;
    ctx.font = `400 ${skuFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const skuW = skuText ? ctx.measureText(skuText).width : 0;
    ctx.font = `900 ${priceFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const priceW = priceText ? ctx.measureText(priceText).width : 0;
    const rowW = skuW + (skuW && priceW ? rowGap : 0) + priceW;

    let rowX = (widthPx - rowW) / 2;
    if (skuText) {
      ctx.font = `400 ${skuFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(skuText, rowX, cursorY);
      rowX += skuW + rowGap;
    }
    if (priceText) {
      ctx.font = `900 ${priceFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(priceText, rowX, cursorY);
    }
    cursorY += priceRowH;
  }

  // --- PASS 2: barcode (flush under the text row) ------------------------
  if (barCanvas) {
    cursorY += gapPriceBar;
    const maxBarWidth = widthPx - padX * 2;
    const scale = maxBarWidth / barCanvas.width;
    const drawW = Math.floor(barCanvas.width * scale);
    const drawH = Math.floor(barCanvas.height * scale);
    const dx = Math.floor((widthPx - drawW) / 2);
    ctx.drawImage(barCanvas, dx, cursorY, drawW, drawH);
  }

  // --- Step 2 + 3: threshold + pack to 1-bit bytes ------------------------
  const { packedBase64, widthBytes } = packMonochrome(ctx, widthPx, heightPx);

  return { packedBase64, widthBytes, widthPx, heightPx };
}
