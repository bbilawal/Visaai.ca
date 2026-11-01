// fontkit 1.1.1's UMD bundle (used by pdf.embedFont subsetting for complex-script
// fonts — the CJK OTF and Devanagari) references a global `regeneratorRuntime`.
// Node does not provide it, so embedding those fonts throws "regeneratorRuntime is
// not defined" in production. Importing regenerator-runtime sets the global as a
// side effect, before any embedFont call runs.
import 'regenerator-runtime/runtime';

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PrefilledFormPayload } from '@visaai/types';
import { pickFont, loadFont, type Script } from './pdf-fonts';
import { shapeText } from './pdf-shape';

const MARGIN = 50;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LINE_HEIGHT = 16;
const LABEL_WIDTH = 200;

interface RenderCtx {
  regular: PDFFont;
  bold: PDFFont;
  script: Script;
  rtl: boolean;
  legacy: boolean; // true => embedding failed, draw ascii-only Helvetica fallback
}

export async function renderPrefilledFormPdf(
  payload: PrefilledFormPayload,
  locale: string = 'en',
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const ctx = await buildCtx(pdf, locale);

  const cursor = {
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN,
  };

  // Document chrome + labels stay English (HARD CONSTRAINT: no MT of gov/legal
  // copy). Only user-data values carry the applicant's script. Everything is
  // drawn with the locale font, which includes Latin glyphs.
  drawText(
    ctx,
    cursor.page,
    ctx.bold,
    18,
    'Visa Application — AI Prefilled Form',
    cursor.y,
  );
  cursor.y -= 28;
  drawText(
    ctx,
    cursor.page,
    ctx.regular,
    11,
    `${payload.countryCode || '—'} · ${payload.visaType || '—'} · ${payload.purpose || '—'}`,
    cursor.y,
  );
  cursor.y -= 14;
  drawText(
    ctx,
    cursor.page,
    ctx.regular,
    9,
    `Generated ${new Date(payload.generatedAt).toLocaleString()} by VisaAI. Review every field before submitting.`,
    cursor.y,
    rgb(0.45, 0.45, 0.45),
  );
  cursor.y -= 24;

  const grouped = groupByKey(payload.fields);
  for (const [group, fields] of grouped) {
    ensureSpace(pdf, cursor, 40);
    drawText(ctx, cursor.page, ctx.bold, 13, group, cursor.y);
    cursor.y -= 6;
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: PAGE_WIDTH - MARGIN, y: cursor.y },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
    cursor.y -= 14;

    for (const field of fields) {
      const valueLines = wrap(
        field.value || '—',
        ctx,
        ctx.bold,
        10,
        PAGE_WIDTH - MARGIN * 2 - LABEL_WIDTH,
      );
      const blockHeight =
        Math.max(LINE_HEIGHT, valueLines.length * LINE_HEIGHT) + 4;
      ensureSpace(pdf, cursor, blockHeight + 4);

      // Label column. LTR: left at MARGIN. RTL: right-aligned at the right margin.
      drawText(
        ctx,
        cursor.page,
        ctx.regular,
        10,
        field.label,
        cursor.y,
        rgb(0.35, 0.35, 0.35),
      );

      let lineY = cursor.y;
      for (const line of valueLines) {
        drawValue(ctx, cursor.page, ctx.bold, 10, line, lineY);
        lineY -= LINE_HEIGHT;
      }
      cursor.y -= blockHeight;
    }
    cursor.y -= 8;
  }

  return pdf.save();
}

async function buildCtx(pdf: PDFDocument, locale: string): Promise<RenderCtx> {
  try {
    const choice = pickFont(locale);
    pdf.registerFontkit(fontkit);
    const regular = await pdf.embedFont(loadFont(choice.regularFile), {
      subset: true,
    });
    const bold =
      choice.boldFile === choice.regularFile
        ? regular
        : await pdf.embedFont(loadFont(choice.boldFile), { subset: true });
    return {
      regular,
      bold,
      script: choice.script,
      rtl: choice.rtl,
      legacy: false,
    };
  } catch (err) {
    // Font file missing/corrupt or embed failed: degrade, never 500. Helvetica
    // + ascii-only sanitize (the historical behaviour) keeps PDF generation up.
    // Log it: a silent degrade to '?' boxes for a non-Latin applicant should be
    // visible in production, not invisible.
    console.error(
      '[prefill-pdf] locale font embed failed; falling back to Helvetica:',
      err,
    );
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    return { regular, bold, script: 'latin', rtl: false, legacy: true };
  }
}

/** Title/label/chrome text. Honors RTL right-alignment; never the value column. */
function drawText(
  ctx: RenderCtx,
  page: PDFPage,
  font: PDFFont,
  size: number,
  text: string,
  y: number,
  color = rgb(0.05, 0.05, 0.05),
) {
  const out = render(ctx, text);
  const x = ctx.rtl
    ? PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(out, size)
    : MARGIN;
  page.drawText(out, { x, y: y - size, size, font, color });
}

/** Value column: starts after the label gutter; RTL mirrors to the left gutter. */
function drawValue(
  ctx: RenderCtx,
  page: PDFPage,
  font: PDFFont,
  size: number,
  text: string,
  y: number,
  color = rgb(0.05, 0.05, 0.05),
) {
  const out = render(ctx, text);
  const x = ctx.rtl
    ? PAGE_WIDTH - MARGIN - LABEL_WIDTH - font.widthOfTextAtSize(out, size)
    : MARGIN + LABEL_WIDTH;
  page.drawText(out, { x, y: y - size, size, font, color });
}

function render(ctx: RenderCtx, text: string): string {
  return ctx.legacy ? sanitize(text) : shapeText(text, ctx.script);
}

function sanitize(text: string): string {
  // Only used in the Helvetica fallback path; WinAnsi cannot encode non-latin.
  return text.replace(/[^\x20-\x7E\n]/g, '?');
}

function ensureSpace(
  pdf: PDFDocument,
  cursor: { page: PDFPage; y: number },
  needed: number,
) {
  if (cursor.y - needed < MARGIN) {
    cursor.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursor.y = PAGE_HEIGHT - MARGIN;
  }
}

/**
 * Word-wrap by measured (shaped) width. CJK has no spaces, so when a single
 * whitespace token still overflows, fall back to per-character breaking.
 *
 * Arabic is shaped per whitespace-separated word here, which is accurate for
 * pure-Arabic text (convertArabic does not join across spaces). A mixed
 * RTL/LTR value (e.g. a name with a Latin parenthetical) may wrap at a slightly
 * off boundary — acceptable for a summary document per the design.
 */
function wrap(
  text: string,
  ctx: RenderCtx,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const width = (s: string) => font.widthOfTextAtSize(render(ctx, s), size);
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (width(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (width(word) <= maxWidth) {
      current = word;
    } else {
      // Space-less overflow (CJK / very long token): break per character.
      let chunk = '';
      for (const ch of word) {
        if (width(chunk + ch) <= maxWidth) {
          chunk += ch;
        } else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function groupByKey(
  fields: PrefilledFormPayload['fields'],
): Map<string, PrefilledFormPayload['fields']> {
  const map = new Map<string, PrefilledFormPayload['fields']>();
  for (const field of fields) {
    const group = field.group || 'Other';
    const list = map.get(group) ?? [];
    list.push(field);
    map.set(group, list);
  }
  return map;
}
