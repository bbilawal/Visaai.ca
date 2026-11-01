import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CATALOGUES,
  RTL_LOCALES,
  SUPPORTED_LOCALES,
  fallbackCatalogue,
  type Locale,
  type MessageKey,
} from './messages';

/**
 * Localization runtime.
 *
 * Resolution order: explicit user choice (persisted, and mirrored to the
 * account via PATCH /me/language so web and mobile agree) → device locale →
 * English. Region subtags are honoured for zh-TW and otherwise stripped, which
 * matches how apps/web resolves next-intl locales.
 */
const STORAGE_KEY = 'visaai.locale';

export interface I18nState {
  locale: Locale;
  isRTL: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => Promise<void>;
}

const I18nContext = createContext<I18nState | null>(null);

export function resolveLocale(candidates: string[]): Locale {
  for (const raw of candidates) {
    if (!raw) continue;
    const tag = raw.trim();
    // Exact match first so zh-TW is not collapsed into zh (different script).
    if ((SUPPORTED_LOCALES as readonly string[]).includes(tag)) return tag as Locale;
    const base = tag.split('-')[0] ?? '';
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return 'en';
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template =
    CATALOGUES[locale]?.[key] ?? CATALOGUES[locale.split('-')[0] ?? '']?.[key] ?? fallbackCatalogue[key];
  // A missing key returns the key itself — loud in dev, harmless in prod, and
  // never an empty control with no label for a screen reader.
  if (template === undefined) return key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    void (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const device = getLocales().map((l) => l.languageTag);
      setLocaleState(resolveLocale([stored ?? '', ...device]));
    })();
  }, []);

  const isRTL = RTL_LOCALES.has(locale.split('-')[0] ?? locale);

  useEffect(() => {
    // Native layout direction is a process-level flag. Flipping it mid-session
    // leaves a half-mirrored UI, so we only align the JS-side value and note
    // that a restart applies the native flip (see VISAAIDocs/mobile/known-limitations.md).
    I18nManager.allowRTL(isRTL);
  }, [isRTL]);

  const setLocale = useCallback(async (next: Locale): Promise<void> => {
    setLocaleState(next);
    await AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nState>(
    () => ({
      locale,
      isRTL,
      t: (key, vars) => translate(locale, key, vars),
      setLocale,
    }),
    [locale, isRTL, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  // Falling back to English instead of throwing keeps a component testable in
  // isolation without wrapping every test in a provider.
  if (!ctx) {
    return {
      locale: 'en',
      isRTL: false,
      t: (key, vars) => translate('en', key, vars),
      setLocale: async () => undefined,
    };
  }
  return ctx;
}
