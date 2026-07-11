/**
 * Label renderer: composes the barcode label onto a 1-bit monochromatic canvas
 * and packs the pixel data into a byte stream the Rust `print_label` command
 * expects (row-major, MSB-first, byte-aligned rows).
 *
 * Pipeline (Hybrid Direct RAW Graphics):
 *   1. Draw to an offscreen <canvas> at the printer's native DPI.
 *   2. Threshold every pixel → pure black or white (no AA, no dither).
 *   3. Pack 8 horizontal pixels into one byte, MSB first, pad rows to a byte.
 *
 * Barcodes are drawn as integer-width filled rects (never scaled bitmaps) so
 * thermal heads like the XP-350B get solid, evenly spaced modules that scan
 * like retail labels — not fuzzy anti-aliased bars from scaled canvases.
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

/**
 * Barcode sizing overrides. The barcode is drawn as an image and these act as
 * independent multipliers on its final dimensions:
 * - `widthScale`  — fraction of the available width the barcode occupies
 *                   (1 = full width, <1 = narrower with side margins).
 * - `heightScale` — vertical multiplier on the rendered bar height
 *                   (<1 = shorter bars, frees vertical space).
 * - `scale`       — uniform zoom applied on top of both.
 * All default to 1. Useful for fitting the barcode onto small labels, since the
 * default bar height is otherwise proportional to the label and can still feel
 * large on a 25×17mm tag. Extreme shrinking may affect scanner readability.
 */
export interface BarcodeSize {
  widthScale?: number;
  heightScale?: number;
  scale?: number;
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
   * Horizontal shift in printer dots applied to every drawn element.
   * Negative = left, positive = right. Applied identically in preview and
   * print (true WYSIWYG) so the merchant can compensate for left-rail media
   * registration on machines like the Xprinter XP-350B. Default 0.
   */
  shiftX?: number;
  /** Per-element visibility. Omit for "show everything". */
  visibility?: LabelVisibility;
  /** Per-element font scale + vertical offset overrides. Omit for defaults. */
  styling?: LabelStyling;
  /** Barcode width/height/scale overrides. Omit for defaults. */
  barcodeSize?: BarcodeSize;
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

// ─── Crisp EAN-13 (integer modules, no scaled bitmaps) ─────────────────────
//
// Retail-quality thermal barcodes fail when bars are drawn as a soft image and
// then scaled — grey edges threshold into broken modules. We encode EAN-13
// ourselves and paint each module as a solid black/white rectangle at an
// integer module width so every line is a clean run of dots.

/** EAN-13 left-hand odd (L) encodings — 7 modules, 0=space 1=bar. */
const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
/** EAN-13 left-hand even (G) encodings. */
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
/** EAN-13 right-hand (R) encodings. */
const EAN_R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
/** First-digit parity table for the six left digits (L or G). */
const EAN_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/** 5×7 bitmap glyphs for digits 0–9 (rows top→bottom, bit 4 = leftmost). */
const DIGIT_5X7: number[][] = [
  [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110], // 0
  [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110], // 1
  [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111], // 2
  [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110], // 3
  [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010], // 4
  [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110], // 5
  [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110], // 6
  [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000], // 7
  [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110], // 8
  [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100], // 9
];

/**
 * Normalize a raw barcode string to a full 13-digit EAN-13 (with check digit).
 * Accepts 12 digits (check digit is computed) or 13 digits (recomputed if needed
 * so the bars always encode a valid symbol). Returns null if unusable.
 */
export function normalizeEan13(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 12 && digits.length !== 13) return null;
  const body = digits.slice(0, 12);
  if (!/^\d{12}$/.test(body)) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = body.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? n : n * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return body + String(check);
}

/** Build the 95-module binary string (0=space, 1=bar) for a valid 13-digit EAN. */
function ean13Modules(ean13: string): string {
  const d = ean13.split('').map(c => c.charCodeAt(0) - 48);
  const parity = EAN_PARITY[d[0]];
  let bits = '101'; // start guard
  for (let i = 0; i < 6; i++) {
    const digit = d[i + 1];
    bits += parity[i] === 'L' ? EAN_L[digit] : EAN_G[digit];
  }
  bits += '01010'; // center guard
  for (let i = 0; i < 6; i++) {
    bits += EAN_R[d[i + 7]];
  }
  bits += '101'; // end guard
  return bits;
}

/**
 * Pick the largest integer module width that still fits, then the widest quiet
 * zone that fits at that width. Prefer module ≥ 2 dots (thermal scanners hate
 * 1-dot modules) even if quiet zones have to shrink a little.
 */
function pickModuleGeometry(availWidth: number): { moduleW: number; quiet: number } {
  const SYMBOL = 95; // fixed EAN-13 module count
  // Prefer wider modules first (thermal scanners need ≥2 dots/module when
  // possible). Quiet zones shrink before modules do — on 25×17 tags a 2-dot
  // module with tight quiet zones scans far better than 1-dot with huge quiet.
  for (let moduleW = 4; moduleW >= 1; moduleW--) {
    for (let quiet = 11; quiet >= 2; quiet--) {
      if ((SYMBOL + quiet * 2) * moduleW <= availWidth) {
        return { moduleW, quiet };
      }
    }
  }
  return { moduleW: 1, quiet: 2 };
}

/** Draw a single digit as solid black blocks (no anti-aliasing). */
function drawBitmapDigit(
  ctx: CanvasRenderingContext2D,
  digit: number,
  x: number,
  y: number,
  px: number,
): number {
  const glyph = DIGIT_5X7[digit];
  if (!glyph || px < 1) return 0;
  ctx.fillStyle = '#000000';
  const dot = Math.max(1, px);
  for (let row = 0; row < 7; row++) {
    const bits = glyph[row];
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) {
        ctx.fillRect(x + col * px, y + row * px, dot, dot);
      }
    }
  }
  return 5 * px;
}

/** Draw a run of digits with integer pixel scale and fixed tracking. */
function drawBitmapDigits(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  tracking = 1,
): number {
  let cx = x;
  for (const ch of text) {
    const d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 9) continue;
    drawBitmapDigit(ctx, d, cx, y, px);
    cx += 5 * px + tracking * px;
  }
  return cx - x;
}

function bitmapDigitsWidth(len: number, px: number, tracking = 1): number {
  if (len <= 0) return 0;
  return len * 5 * px + (len - 1) * tracking * px;
}

export interface CrispBarcodeLayout {
  /** Total block width in dots (quiet + symbol, not counting outer first digit). */
  width: number;
  /** Total block height (bars + gap + digits). */
  height: number;
  /** Integer module width used (dots per EAN module). */
  moduleW: number;
  /** Draw bars + human-readable digits at integer (x, y). */
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void;
}

/**
 * Layout a crisp EAN-13 for the given available width / bar height.
 * Bars are never scaled after rasterization — only integer module widths.
 */
function layoutCrispEan13(
  barcode: string,
  availWidth: number,
  targetBarHeight: number,
): CrispBarcodeLayout | null {
  const ean = normalizeEan13(barcode);
  if (!ean) return null;

  const avail = Math.max(8, Math.floor(availWidth));
  const { moduleW, quiet } = pickModuleGeometry(avail);
  const modules = ean13Modules(ean);
  const symbolW = modules.length * moduleW;
  // Spread leftover horizontal dots into the quiet zones so bars stay centered
  // and quiet zones grow when the label is wider than the symbol.
  const baseQuietPx = quiet * moduleW;
  const leftover = Math.max(0, avail - (symbolW + baseQuietPx * 2));
  const quietLeft = baseQuietPx + Math.floor(leftover / 2);
  const quietRight = baseQuietPx + Math.ceil(leftover / 2);
  const quietPx = quietLeft; // left pad used as the primary quiet origin
  const totalW = quietLeft + symbolW + quietRight;

  // Taller bars scan better. Floor of 22 dots keeps short 25×17 tags usable.
  const barH = Math.max(22, Math.round(targetBarHeight));
  // Guard bars extend slightly lower (retail style) so the symbol "anchors".
  const guardExtra = Math.max(2, Math.round(moduleW * 1.5));
  // Digit pixel scale: integer only. Prefer 2× on roomy labels, 1× on tiny ones.
  const digitPx = moduleW >= 2 ? 2 : 1;
  const digitH = 7 * digitPx;
  const digitGap = Math.max(2, moduleW);
  const totalH = barH + guardExtra + digitGap + digitH;

  const leftDigits = ean.slice(1, 7);
  const rightDigits = ean.slice(7, 13);
  const firstDigit = ean[0];

  // First digit sits in the left quiet zone / just outside, retail-style.
  const firstW = bitmapDigitsWidth(1, digitPx);
  // Extra left margin if first digit needs room outside the quiet zone.
  const lead = Math.max(0, firstW + digitPx - quietPx);

  return {
    width: totalW + lead,
    height: totalH,
    moduleW,
    draw(ctx, originX, originY) {
      // Disable any smoothing — pure binary drawing only.
      ctx.imageSmoothingEnabled = false;
      const baseX = Math.round(originX) + lead;
      const baseY = Math.round(originY);

      // Paint white underlay so partial overlaps stay clean.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(baseX - lead, baseY, totalW + lead, totalH);

      // Merge consecutive bar modules into solid runs (cleaner than 1-wide fills).
      // Every rect is integer-aligned: moduleW is int, indices are int → no blur.
      ctx.fillStyle = '#000000';
      let i = 0;
      while (i < modules.length) {
        if (modules[i] !== '1') {
          i++;
          continue;
        }
        let j = i + 1;
        while (j < modules.length && modules[j] === '1') j++;
        const run = j - i;
        // Guard patterns (start/center/end) get the longer "descender".
        const isGuard =
          (i < 3) ||
          (i >= 45 && i < 50) ||
          (i >= 92);
        const h = isGuard ? barH + guardExtra : barH;
        ctx.fillRect(
          baseX + quietLeft + i * moduleW,
          baseY,
          run * moduleW,
          h,
        );
        i = j;
      }

      // Human-readable digits — bitmap, so every pixel is pure black/white.
      const digitY = baseY + barH + guardExtra + digitGap;
      // First digit left of the symbol (retail convention).
      drawBitmapDigit(ctx, firstDigit.charCodeAt(0) - 48, baseX - lead, digitY, digitPx);

      // Left group centered under left half (modules 3..45).
      const leftRegionX = baseX + quietLeft + 3 * moduleW;
      const leftRegionW = 42 * moduleW;
      const leftTextW = bitmapDigitsWidth(6, digitPx);
      drawBitmapDigits(
        ctx,
        leftDigits,
        leftRegionX + Math.floor((leftRegionW - leftTextW) / 2),
        digitY,
        digitPx,
      );

      // Right group centered under right half (modules 50..92).
      const rightRegionX = baseX + quietLeft + 50 * moduleW;
      const rightRegionW = 42 * moduleW;
      const rightTextW = bitmapDigitsWidth(6, digitPx);
      drawBitmapDigits(
        ctx,
        rightDigits,
        rightRegionX + Math.floor((rightRegionW - rightTextW) / 2),
        digitY,
        digitPx,
      );
    },
  };
}

/**
 * Fallback for non-EAN values: JsBarcode CODE128 at an integer module width,
 * copied 1:1 onto the label (never fractionally scaled — that blurs bars).
 */
function layoutFallbackCode128(
  barcode: string,
  availWidth: number,
  targetBarHeight: number,
): CrispBarcodeLayout | null {
  const value = String(barcode ?? '').replace(/\s+/g, '');
  if (!value) return null;

  const barH = Math.max(22, Math.round(targetBarHeight));
  // Start wide and step down until the symbol fits the available width.
  let startMw = Math.min(4, Math.max(1, Math.floor(availWidth / Math.max(48, value.length * 11 + 24))));
  let fitCanvas: HTMLCanvasElement | null = null;
  let usedMw = 1;

  for (let mw = startMw; mw >= 1; mw--) {
    const c = document.createElement('canvas');
    try {
      JsBarcode(c, value, {
        format: 'CODE128',
        width: mw,
        height: barH,
        displayValue: true,
        font: 'monospace',
        fontOptions: 'bold',
        fontSize: Math.max(12, mw * 6),
        textMargin: 2,
        margin: mw * 4,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      continue;
    }
    if (c.width <= 0 || c.height <= 0) continue;
    fitCanvas = c;
    usedMw = mw;
    if (c.width <= availWidth) break;
  }

  if (!fitCanvas) return null;
  const w = fitCanvas.width;
  const h = fitCanvas.height;
  const src = fitCanvas;
  return {
    width: w,
    height: h,
    moduleW: usedMw,
    draw(ctx, x, y) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, Math.round(x), Math.round(y));
    },
  };
}

function layoutBarcode(
  barcode: string,
  availWidth: number,
  targetBarHeight: number,
): CrispBarcodeLayout | null {
  return (
    layoutCrispEan13(barcode, availWidth, targetBarHeight) ??
    layoutFallbackCode128(barcode, availWidth, targetBarHeight)
  );
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
          // Aggressive threshold: greys from font AA become solid black so
          // thermal output stays thick and readable (retail-label look).
          black = lum < 180;
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
  bsize: Required<BarcodeSize>,
) {
  const { barcode, productName, variantName, price, widthPx, heightPx } = input;
  // Horizontal shift in dots — same value for preview and print (WYSIWYG).
  // XP-350B (and similar) load media on the left rail; if content lands too
  // far right on the physical tag, lower this (negative = move left).
  const shiftX = Math.round(input.shiftX ?? 0);

  // --- Step 1a: white background, crisp settings ---------------------------
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;

  // Side padding keeps quiet zones / text off the die-cut edge. Content is
  // still free to move with shiftX so the merchant can match left-rail media.
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

  // Barcode uses the full label width by default so we can keep 2-dot modules
  // on 25mm tags. Saved settings below 0.8 are clamped back up because they
  // produce skinny bars and clipped human-readable digits on small labels.
  const barcodeSafeX = Math.max(4, Math.round(widthPx * 0.025));
  const barAreaWidth = Math.max(
    8,
    Math.floor((widthPx - barcodeSafeX * 2) * Math.min(1, Math.max(0.8, bsize.widthScale * bsize.scale))),
  );
  // Taller default bars (~38% of label height) — scanners need vertical mass.
  const defaultBarH = Math.round(heightPx * 0.38) * Math.max(0.7, bsize.heightScale) * Math.max(0.8, bsize.scale);
  let barcodeLayout = vis.barcode
    ? layoutBarcode(barcode, barAreaWidth, defaultBarH)
    : null;

  // Tight inter-block spacing: keeps content grouped, centered as one block.
  const gapNameVariant = Math.round(heightPx * 0.01);
  const gapVariantPrice = Math.round(heightPx * 0.015);
  const gapPriceBar = Math.round(heightPx * 0.02);

  const textContentH =
    nameBlockH +
    (variantBlockH ? gapNameVariant + variantBlockH : 0) +
    (priceBlockH ? gapVariantPrice + priceBlockH : 0);
  const barcodeGapH = barcodeLayout ? gapPriceBar : 0;
  const maxContentH = Math.max(24, heightPx - padX * 2);

  if (barcodeLayout && textContentH + barcodeGapH + barcodeLayout.height > maxContentH) {
    const availableBarcodeH = Math.max(24, maxContentH - textContentH - barcodeGapH);
    const overflow = textContentH + barcodeGapH + barcodeLayout.height - maxContentH;
    const fittedBarH = Math.max(22, Math.round(defaultBarH - overflow));
    barcodeLayout = layoutBarcode(barcode, barAreaWidth, Math.min(fittedBarH, availableBarcodeH));
  }

  const barBlockH = barcodeLayout ? barcodeLayout.height : 0;
  const totalContentH = textContentH + (barcodeLayout ? gapPriceBar + barBlockH : 0);

  // Vertical center offset. Floor so we don't blur rows across dot boundaries.
  let cursorY = Math.max(2, Math.floor((heightPx - totalContentH) / 2));

  // Horizontal placement helper: center within the label, then apply shiftX.
  // Clamped so a large left/right offset never fully ejects content off-canvas
  // (which previously made barcodes "disappear" on the XP-350B after calibration).
  const placeX = (elementWidth: number, edgePad = padX): number => {
    if (elementWidth >= widthPx - edgePad * 2) {
      return Math.round((widthPx - elementWidth) / 2);
    }
    const centered = (widthPx - elementWidth) / 2;
    const raw = centered + shiftX;
    const minX = edgePad;
    const maxX = widthPx - elementWidth - edgePad;
    return Math.round(Math.max(minX, Math.min(maxX, raw)));
  };

  // --- PASS 2: draw name (centered, sized) -------------------------------
  // Each element's draw Y also gets its own offsetY nudge (dots).
  ctx.font = `700 ${nameFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const nameStartY = cursorY + style.name.offsetY;
  let nameY = nameStartY;
  for (const line of nameLines) {
    const lineW = ctx.measureText(line).width;
    ctx.fillText(line, placeX(lineW), nameY);
    nameY += nameLineHeight;
  }
  cursorY += nameBlockH;

  // --- PASS 2: variant title (centered, smaller than name) ---------------
  if (variantText) {
    cursorY += gapNameVariant;
    ctx.font = `400 ${variantFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const vw = ctx.measureText(variantText).width;
    ctx.fillText(variantText, placeX(vw), cursorY + style.variant.offsetY);
    cursorY += variantBlockH;
  }

  // --- PASS 2: price (centered, the dominant element) --------------------
  if (priceText) {
    cursorY += gapVariantPrice;
    ctx.font = `900 ${priceFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const pw = ctx.measureText(priceText).width;
    ctx.fillText(priceText, placeX(pw), cursorY + style.price.offsetY);
    cursorY += priceBlockH;
  }

  // --- PASS 2: barcode (flush under the price) --------------------------
  // Drawn 1:1 at integer coordinates — no drawImage scaling.
  if (barcodeLayout) {
    cursorY += gapPriceBar;
    const dx = placeX(barcodeLayout.width, barcodeSafeX);
    const dy = Math.round(cursorY + 2);
    barcodeLayout.draw(ctx, dx, dy);
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

/** Normalize a partial barcode-size object so all three multipliers are set. */
function resolveBarcodeSize(b: BarcodeSize | undefined): Required<BarcodeSize> {
  return {
    widthScale: b?.widthScale ?? 1,
    heightScale: b?.heightScale ?? 1,
    scale: b?.scale ?? 1,
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

  drawLabel(ctx, input, resolveVisibility(input.visibility), resolveStyling(input.styling), resolveBarcodeSize(input.barcodeSize));

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

  drawLabel(ctx, { ...input, widthPx: w }, resolveVisibility(input.visibility), resolveStyling(input.styling), resolveBarcodeSize(input.barcodeSize));
  return canvas.toDataURL('image/png');
}
