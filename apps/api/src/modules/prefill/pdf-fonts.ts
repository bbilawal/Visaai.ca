import { readFileSync } from 'fs';
import { join } from 'path';

export type Script = 'latin' | 'arabic' | 'devanagari' | 'cjk';

export interface FontChoice {
  regularFile: string;
  boldFile: string; // for cjk, equals regularFile (one weight bundled)
  script: Script;
  rtl: boolean;
}

const FONTS_DIR = join(__dirname, 'fonts');

// Keep these 15 codes in sync with apps/web/i18n/config.ts LOCALES.
const LOCALE_SCRIPT: Record<string, Script> = {
  en: 'latin',
  fr: 'latin',
  es: 'latin',
  de: 'latin',
  it: 'latin',
  pt: 'latin',
  nl: 'latin',
  tr: 'latin',
  ar: 'arabic',
  ur: 'arabic',
  hi: 'devanagari',
  zh: 'cjk',
  'zh-TW': 'cjk',
  ja: 'cjk',
  ko: 'cjk',
};

const SCRIPT_FILES: Record<
  Script,
  { regular: string; bold: string; rtl: boolean }
> = {
  latin: {
    regular: 'NotoSans_400Regular.ttf',
    bold: 'NotoSans_700Bold.ttf',
    rtl: false,
  },
  arabic: {
    regular: 'NotoSansArabic_400Regular.ttf',
    bold: 'NotoSansArabic_700Bold.ttf',
    rtl: true,
  },
  devanagari: {
    regular: 'NotoSansDevanagari_400Regular.ttf',
    bold: 'NotoSansDevanagari_700Bold.ttf',
    rtl: false,
  },
  cjk: {
    regular: 'NotoSansCJKsc-Regular.otf',
    bold: 'NotoSansCJKsc-Regular.otf',
    rtl: false,
  },
};

export function scriptForLocale(locale: string | null | undefined): Script {
  if (!locale) return 'latin';
  return (
    LOCALE_SCRIPT[locale] ?? LOCALE_SCRIPT[locale.split('-')[0]] ?? 'latin'
  );
}

export function pickFont(locale: string | null | undefined): FontChoice {
  const script = scriptForLocale(locale);
  const f = SCRIPT_FILES[script];
  return { regularFile: f.regular, boldFile: f.bold, script, rtl: f.rtl };
}

const cache = new Map<string, Buffer>();

export function loadFont(file: string): Buffer {
  let buf = cache.get(file);
  if (!buf) {
    buf = readFileSync(join(FONTS_DIR, file));
    cache.set(file, buf);
  }
  return buf;
}
