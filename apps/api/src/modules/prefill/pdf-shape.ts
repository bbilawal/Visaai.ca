import { convertArabic } from 'arabic-reshaper';
import bidiFactory from 'bidi-js';
import type { Script } from './pdf-fonts';

// pdf-lib has no text-shaping engine: it draws codepoints left-to-right with no
// contextual joining or bidi. So we pre-shape Arabic — join letters into their
// contextual presentation forms, then reorder to visual order — and draw the
// result LTR, which renders correctly. Other scripts need no pre-shaping (CJK
// and Devanagari values draw acceptably as-is for a summary doc).
const bidi = bidiFactory();

export function shapeText(text: string, script: Script): string {
  if (script !== 'arabic' || !text) return text;
  try {
    const reshaped = convertArabic(text);
    return bidi.getReorderedString(reshaped, bidi.getEmbeddingLevels(reshaped));
  } catch {
    // Pathological input — draw the raw string rather than failing the document.
    return text;
  }
}
