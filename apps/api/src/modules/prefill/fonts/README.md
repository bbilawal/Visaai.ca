# Bundled fonts for prefill summary PDF

All fonts are SIL Open Font License (OFL). Vendored so PDF rendering is offline
and deterministic (no runtime font fetch on a paid path).

| File | Family | Source |
|------|--------|--------|
| NotoSans_400Regular.ttf / _700Bold.ttf | Noto Sans | @expo-google-fonts/noto-sans (^0.2) |
| NotoSansArabic_400Regular.ttf / _700Bold.ttf | Noto Sans Arabic | @expo-google-fonts/noto-sans-arabic (^0.2) |
| NotoSansDevanagari_400Regular.ttf / _700Bold.ttf | Noto Sans Devanagari | @expo-google-fonts/noto-sans-devanagari (^0.2) |
| NotoSansCJKsc-Regular.otf | Noto Sans CJK (pan-CJK superfont) | github.com/notofonts/noto-cjk `Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf` |

The CJK file is the pan-CJK superfont (covers zh/zh-TW/ja kana/ko hangul), NOT
"Noto Sans SC" (Han-only, no hangul). To refresh, re-run the copy/curl steps in
VISAAIDocs `archive/plans/2026-06-12-phase-4-rtl-cjk-pdf.md` Task 1.
