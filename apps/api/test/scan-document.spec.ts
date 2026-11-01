/**
 * ISSUE-3: mandatory malware scan-gate. Tests the pure content inspector that
 * runs on every uploaded document.
 */
import {
  detectType,
  inspectFileBytes,
} from '../src/modules/documents/graphs/nodes/scan-document';

const MAX = 15 * 1024 * 1024;

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00);
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46);
const SHELL = bytes(0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e);
const HTML = bytes(0x3c, 0x21, 0x44, 0x4f, 0x43);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);

describe('ISSUE-3 detectType (magic numbers)', () => {
  it('identifies allowed image/pdf types', () => {
    expect(detectType(PNG)).toBe('png');
    expect(detectType(JPEG)).toBe('jpeg');
    expect(detectType(PDF)).toBe('pdf');
  });

  it('identifies dangerous types', () => {
    expect(detectType(EXE)).toBe('exe');
    expect(detectType(ELF)).toBe('elf');
    expect(detectType(SHELL)).toBe('script');
    expect(detectType(HTML)).toBe('markup');
    expect(detectType(ZIP)).toBe('zip');
  });
});

describe('ISSUE-3 inspectFileBytes (fail closed)', () => {
  it('accepts a real PNG declared as image/png', () => {
    expect(inspectFileBytes(PNG, 'image/png', MAX)).toMatchObject({
      ok: true,
      detected: 'png',
    });
  });

  it('accepts a real PDF declared as application/pdf', () => {
    expect(inspectFileBytes(PDF, 'application/pdf', MAX)).toMatchObject({
      ok: true,
      detected: 'pdf',
    });
  });

  it('rejects a Windows executable masquerading as a PNG', () => {
    const v = inspectFileBytes(EXE, 'image/png', MAX);
    expect(v.ok).toBe(false);
    expect(v.detected).toBe('exe');
  });

  it('rejects an ELF binary', () => {
    expect(inspectFileBytes(ELF, 'application/octet-stream', MAX).ok).toBe(
      false,
    );
  });

  it('rejects a shell script', () => {
    expect(inspectFileBytes(SHELL, 'text/plain', MAX).ok).toBe(false);
  });

  it('rejects HTML/SVG markup (script-carrying)', () => {
    expect(inspectFileBytes(HTML, 'image/svg+xml', MAX).ok).toBe(false);
  });

  it('rejects a declared/detected family mismatch (PDF labelled as image)', () => {
    const v = inspectFileBytes(PDF, 'image/png', MAX);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/does not match/i);
  });

  it('rejects empty and oversized files', () => {
    expect(inspectFileBytes(new Uint8Array(0), 'image/png', MAX).ok).toBe(
      false,
    );
    expect(inspectFileBytes(PNG, 'image/png', 4).ok).toBe(false);
  });
});
