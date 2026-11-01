import {
  MAX_FILE_BYTES,
  assessImageQuality,
  mimeFromName,
  sanitizeFileName,
  validateDocument,
} from './validation';

describe('sanitizeFileName', () => {
  it('strips directory components', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\passport.pdf')).toBe('passport.pdf');
  });

  it('replaces characters that are unsafe in a storage path', () => {
    expect(sanitizeFileName('my passport (1).pdf')).toBe('my_passport__1_.pdf');
  });

  it('strips leading dots so no hidden file is created', () => {
    expect(sanitizeFileName('.hidden.pdf')).toBe('hidden.pdf');
  });

  it('caps very long names', () => {
    expect(sanitizeFileName(`${'a'.repeat(400)}.pdf`).length).toBeLessThanOrEqual(120);
  });
});

describe('mimeFromName', () => {
  it('maps known extensions', () => {
    expect(mimeFromName('a.pdf')).toBe('application/pdf');
    expect(mimeFromName('a.JPG')).toBe('image/jpeg');
    expect(mimeFromName('a.heic')).toBe('image/heic');
  });

  it('returns null for an unknown extension', () => {
    expect(mimeFromName('a.exe')).toBeNull();
    expect(mimeFromName('noextension')).toBeNull();
  });
});

describe('validateDocument', () => {
  it('accepts a normal PDF', () => {
    const result = validateDocument({
      fileName: 'passport.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(result).toEqual({ ok: true, mimeType: 'application/pdf', fileName: 'passport.pdf' });
  });

  it('trusts the extension over a generic octet-stream MIME from the picker', () => {
    const result = validateDocument({
      fileName: 'scan.png',
      mimeType: 'application/octet-stream',
      sizeBytes: 2048,
    });
    expect(result).toMatchObject({ ok: true, mimeType: 'image/png' });
  });

  it('falls back to the declared MIME when the name has no usable extension', () => {
    const result = validateDocument({ fileName: 'scan', mimeType: 'image/jpeg', sizeBytes: 100 });
    expect(result).toMatchObject({ ok: true, mimeType: 'image/jpeg' });
  });

  it('rejects a disallowed type', () => {
    expect(
      validateDocument({ fileName: 'malware.exe', mimeType: 'application/x-msdownload' }),
    ).toEqual({ ok: false, reason: 'bad-type' });
  });

  it('rejects a file over the size cap', () => {
    expect(
      validateDocument({ fileName: 'huge.pdf', sizeBytes: MAX_FILE_BYTES + 1 }),
    ).toMatchObject({ ok: false, reason: 'too-large' });
  });

  it('accepts a file exactly at the cap', () => {
    expect(validateDocument({ fileName: 'edge.pdf', sizeBytes: MAX_FILE_BYTES })).toMatchObject({
      ok: true,
    });
  });

  it('rejects an empty file', () => {
    expect(validateDocument({ fileName: 'empty.pdf', sizeBytes: 0 })).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('rejects a name that sanitises away to nothing', () => {
    expect(validateDocument({ fileName: '///' })).toEqual({ ok: false, reason: 'bad-name' });
  });

  it('handles a MIME with a charset parameter', () => {
    expect(
      validateDocument({ fileName: 'scan', mimeType: 'application/pdf; charset=binary' }),
    ).toMatchObject({ ok: true, mimeType: 'application/pdf' });
  });
});

describe('assessImageQuality', () => {
  it('accepts a good scan', () => {
    expect(assessImageQuality({ width: 2000, height: 1400, sizeBytes: 800_000 })).toEqual({
      acceptable: true,
      warnings: [],
    });
  });

  it('warns on low resolution', () => {
    expect(
      assessImageQuality({ width: 600, height: 400, sizeBytes: 500_000 }).warnings,
    ).toContain('low-resolution');
  });

  it('warns on an extreme aspect ratio (likely a mis-crop)', () => {
    expect(
      assessImageQuality({ width: 4000, height: 1000, sizeBytes: 900_000 }).warnings,
    ).toContain('extreme-aspect');
  });

  it('warns when a large image compressed suspiciously small', () => {
    expect(assessImageQuality({ width: 2000, height: 1500, sizeBytes: 10_000 }).warnings).toContain(
      'tiny-file',
    );
  });

  it('never hard-blocks — it only reports warnings', () => {
    const result = assessImageQuality({ width: 100, height: 100, sizeBytes: 1 });
    expect(result.acceptable).toBe(false);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
