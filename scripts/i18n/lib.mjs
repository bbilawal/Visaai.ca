// Pure transforms for the i18n review package. No I/O here.

/**
 * Flatten { locale: { ns: { key: value } } } into ordered rows keyed off the
 * `en` master. Each row: { ns, key, en, perLocale: {<non-en>: string}, identical }.
 * `identical` = the value is the same in every non-en locale as en (an
 * english-held candidate — left untranslated, intentionally or by drift).
 */
export function flattenMessages(data, locales) {
  const en = data.en ?? {};
  const others = locales.filter((l) => l !== 'en');
  const rows = [];
  for (const ns of Object.keys(en)) {
    for (const key of Object.keys(en[ns])) {
      const enVal = en[ns][key];
      const perLocale = {};
      for (const l of others) perLocale[l] = (data[l]?.[ns] ?? {})[key] ?? '';
      const identical = others.every((l) => perLocale[l] === enVal);
      rows.push({ ns, key, en: enVal, perLocale, identical });
    }
  }
  return rows;
}

function csvField(v) {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}

/** RFC4180 CSV for one locale: namespace,key,en,<locale>,status (status=pending). */
export function toCsv(rows, locale) {
  const header = ['namespace', 'key', 'en', locale, 'status']
    .map(csvField)
    .join(',');
  const body = rows.map((r) =>
    [r.ns, r.key, r.en, r.perLocale[locale] ?? '', 'pending']
      .map(csvField)
      .join(','),
  );
  return [header, ...body].join('\n') + '\n';
}

/** Tracking manifest: per-key status + per-locale review state + rollup counts. */
export function buildManifest(rows, locales, generatedAt) {
  const others = locales.filter((l) => l !== 'en');
  const counts = {};
  for (const l of others)
    counts[l] = { pending: rows.length, approved: 0, needsFix: 0 };
  const keys = {};
  for (const r of rows) {
    keys[`${r.ns}.${r.key}`] = {
      en: r.en,
      status: r.identical ? 'english_held_candidate' : 'mt',
      perLocale: Object.fromEntries(others.map((l) => [l, 'pending'])),
    };
  }
  return { generatedAt, totalKeys: rows.length, locales: others, counts, keys };
}
