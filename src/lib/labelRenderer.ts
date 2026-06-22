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

/**
 * Per-element visibility toggles. When false, the element is neither measured
 * nor drawn, so the remaining content re-centers to fill the space. All
 * default to true.
 */
export interface LabelVisibility {
  name?: boolean;
  variant?: boolean;
  price?: boolean;
  barcode?: boolean;
}

/**
 * Per-element styling overrides. Each entry optionally scales the element's
 * font size (`fontScale`, 1.0 = default) and nudges its vertical position
 * (`offsetY`, dots, +down / -up). Affects only its own element; the rest of
 * the layout (centering, stacking) is recomputed from the resulting heights.
 */
export interface LabelStyling {
  name?: { fontScale?: number; offsetY?: number };
  variant?: { fontScale?: number; offsetY?: number };
  price?: { fontScale?: number; offsetY?: number };
}

export interface RenderLabelInput {
  barcode: string;
  productName: string;
  /** Optional variant title (e.g. "Red / Large") printed under the product name. */
  variantName?: string | null;
  /** SKU is accepted for API compatibility but no longer printed on the label. */
  sku?: string | null;
  price?: number | null;
  /**
   * Horizontal shift in dots applied to every drawn element. Negative shifts
   * the whole content block left, positive shifts right. Used to compensate
   * for printhead-to-label registration offsets so content sits visually
   * centered on the physical label. Default 0.
   */
  shiftX?: number;
  /** Per-element visibility. Omit for "show everything". */
  visibility?: LabelVisibility;
  /** Per-element font scale + vertical offset overrides. Omit for defaults. */
  styling?: LabelStyling;
  /**
   * When true, merge the variant title into the product name as a single
   * inline title line (e.g. "Product — Red"), drawn at the name's font size.
   * The standalone variant block is then skipped. Default false.
   */
  combineNameVariant?: boolean;
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
 * Draw the label onto `ctx` (white background + black content). Shared by the
 * print path (which then packs the pixels) and the on-screen preview. Caller is
 * responsible for sizing `ctx.canvas` to `widthPx × heightPx` already.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  input: RenderLabelInput,
  vis: Required<LabelVisibility>,
  style: Required<LabelStyling>,
) {
  const { barcode, productName, variantName, price, widthPx, heightPx } = input;
  // Base offset of -40 dots compensates for this Xprinter's printhead-to-label
  // registration offset (content prints ~5mm right of center at 203 DPI). The
  // user-facing H-Shift control is relative to this base, so UI value 0 already
  // includes the correction. Effective shift = userValue - 40.
  const shiftX = Math.round((input.shiftX ?? 0) - 40);

  // --- Step 1a: white background, crisp settings ---------------------------
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;

  const padX = Math.max(4, Math.round(widthPx * 0.04));
  const nameMaxWidth = widthPx - padX * 2;

  // --- PASS 1: measure all content heights so we can center vertically ---
  // Layout: name (small) → variant title (smaller) → price (large) → barcode.
  // SKU is intentionally NOT printed on the label. Each block is gated on both
  // its visibility toggle AND non-empty content, so hidden/empty blocks don't
  // reserve vertical space and the rest re-centers.
  const priceText = vis.price && price != null && price > 0 ? fmt(price) : '';
  const variantRaw = variantName ? variantName.trim() : '';
  // When combining, the variant is merged into the title line and the standalone
  // variant block is suppressed.
  const combine = !!input.combineNameVariant && vis.name && vis.variant && !!variantRaw;
  const variantText = combine ? '' : (vis.variant && variantName ? variantRaw : '');

  // The title text used for fitting/wrapping. When combining, append the variant
  // with an em dash so it reads as "Product — Variant" on one (wrapped) block.
  const titleText = combine && productName
    ? `${productName} — ${variantRaw}`
    : (productName || '');

  // Base font sizes, then scaled per-element by the user's styling overrides.
  // Clamped to a sensible minimum so scaling down never produces invisible text.
  const nameFont = Math.max(5, Math.round(widthPx * 0.045 * style.name.fontScale));
  const variantFont = Math.max(4, Math.round(widthPx * 0.038 * style.variant.fontScale));
  const priceFont = Math.max(7, Math.round(widthPx * 0.11 * style.price.fontScale));

  const nameLines =
    vis.name && productName
      ? fitNameFont(ctx, titleText, nameMaxWidth, Math.round(heightPx * 0.18 * style.name.fontScale), 2).lines
      : [];
  const nameLineHeight = nameFont * 1.12;
  const nameBlockH = nameLines.length * nameLineHeight;

  ctx.font = `400 ${variantFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const variantBlockH = variantText ? variantFont * 1.2 : 0;

  ctx.font = `900 ${priceFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const priceBlockH = priceText ? priceFont * 1.2 : 0;

  const barCanvas = vis.barcode ? renderBarcodeCanvas(barcode, widthPx) : null;
  const barBlockH = barCanvas
    ? Math.floor(barCanvas.height * Math.min((widthPx - padX * 2) / barCanvas.width))
    : 0;

  // Tight inter-block spacing: keeps content grouped, centered as one block.
  const gapNameVariant = Math.round(heightPx * 0.01);
  const gapVariantPrice = Math.round(heightPx * 0.015);
  const gapPriceBar = Math.round(heightPx * 0.02);

  let totalContentH = nameBlockH;
  if (variantBlockH) totalContentH += gapNameVariant + variantBlockH;
  if (priceBlockH) totalContentH += gapVariantPrice + priceBlockH;
  if (barBlockH) totalContentH += gapPriceBar + barBlockH;

  // Vertical center offset. Floor so we don't blur rows across dot boundaries.
  let cursorY = Math.max(padX, Math.floor((heightPx - totalContentH) / 2));

  // --- PASS 2: draw name (centered, sized) -------------------------------
  // Each element's draw Y also gets its own offsetY nudge (dots).
  ctx.font = `700 ${nameFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const nameStartY = cursorY + style.name.offsetY;
  let nameY = nameStartY;
  for (const line of nameLines) {
    ctx.fillText(line, (widthPx - ctx.measureText(line).width) / 2 + shiftX, nameY);
    nameY += nameLineHeight;
  }
  cursorY += nameBlockH;

  // --- PASS 2: variant title (centered, smaller than name) ---------------
  if (variantText) {
    cursorY += gapNameVariant;
    ctx.font = `400 ${variantFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(
      variantText,
      (widthPx - ctx.measureText(variantText).width) / 2 + shiftX,
      cursorY + style.variant.offsetY,
    );
    cursorY += variantBlockH;
  }

  // --- PASS 2: price (centered, the dominant element) --------------------
  if (priceText) {
    cursorY += gapVariantPrice;
    ctx.font = `900 ${priceFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(
      priceText,
      (widthPx - ctx.measureText(priceText).width) / 2 + shiftX,
      cursorY + style.price.offsetY,
    );
    cursorY += priceBlockH;
  }

  // --- PASS 2: barcode (flush under the price) --------------------------
  if (barCanvas) {
    cursorY += gapPriceBar;
    const maxBarWidth = widthPx - padX * 2;
    const scale = maxBarWidth / barCanvas.width;
    const drawW = Math.floor(barCanvas.width * scale);
    const drawH = Math.floor(barCanvas.height * scale);
    const dx = Math.floor((widthPx - drawW) / 2) + shiftX;
    ctx.drawImage(barCanvas, dx, cursorY, drawW, drawH);
  }
}

/** Normalize a partial visibility object to all four booleans. */
function resolveVisibility(v: LabelVisibility | undefined): Required<LabelVisibility> {
  return {
    name: v?.name ?? true,
    variant: v?.variant ?? true,
    price: v?.price ?? true,
    barcode: v?.barcode ?? true,
  };
}

/** Normalize a partial styling object so every element has both knobs. */
function resolveStyling(s: LabelStyling | undefined): Required<LabelStyling> {
  const norm = (e: { fontScale?: number; offsetY?: number } | undefined) => ({
    fontScale: e?.fontScale ?? 1,
    offsetY: e?.offsetY ?? 0,
  });
  return {
    name: norm(s?.name),
    variant: norm(s?.variant),
    price: norm(s?.price),
  };
}

/**
 * Compose the label and return its packed 1-bit bitmap.
 * Throws on invalid barcode / invalid dimensions.
 */
export function renderLabelToBitmap(input: RenderLabelInput): RenderedBitmap {
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

  drawLabel(ctx, input, resolveVisibility(input.visibility), resolveStyling(input.styling));

  // --- Step 2 + 3: threshold + pack to 1-bit bytes ------------------------
  const { packedBase64, widthBytes } = packMonochrome(ctx, widthPx, heightPx);

  return { packedBase64, widthBytes, widthPx, heightPx };
}

/**
 * Render the label to a PNG data URL for on-screen preview. This is the exact
 * same layout the printer will output (same canvas, same drawLabel), just
 * returned as an image instead of packed bytes. Cheap to call on every UI change.
 */
export function renderLabelToDataURL(input: RenderLabelInput): string {
  const { widthPx, heightPx } = input;
  if (widthPx <= 0 || heightPx <= 0) {
    throw new Error(`Invalid canvas dimensions ${widthPx}×${heightPx}`);
  }
  // Preview canvas doesn't need the byte-alignment constraint, but rounding the
  // width up to a multiple of 8 keeps the preview 1:1 with the printed bitmap.
  const w = Math.ceil(widthPx / 8) * 8;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D canvas context');

  drawLabel(ctx, { ...input, widthPx: w }, resolveVisibility(input.visibility), resolveStyling(input.styling));
  return canvas.toDataURL('image/png');
}
