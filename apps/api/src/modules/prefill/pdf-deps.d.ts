declare module 'arabic-reshaper' {
  export function convertArabic(input: string): string;
  export function convertArabicBack(input: string): string;
}

declare module 'bidi-js' {
  export interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  export interface Bidi {
    getEmbeddingLevels(
      text: string,
      direction?: 'ltr' | 'rtl' | 'auto',
    ): EmbeddingLevels;
    getReorderedString(text: string, levels: EmbeddingLevels): string;
  }
  export default function bidiFactory(): Bidi;
}

declare module 'regenerator-runtime/runtime';
