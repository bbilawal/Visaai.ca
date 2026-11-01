import type { DocumentState } from '../document.state';
import { safeLog } from '../../../shared/log/redact';

/**
 * F3 / ISSUE-3: malware scan-gate. MANDATORY for every uploaded document.
 * Runs after fetch_document, before run_ocr.
 *
 * Baseline (always on, no external dependency): download the bytes and verify
 * the real file type by magic number. Only a small allowlist of document/image
 * types is accepted; executables, scripts, archives, HTML/SVG, and unknown
 * content are rejected (fail closed). The declared MIME must match the detected
 * family, so a `.png` that is really a PE binary is blocked.
 *
 * Optional AV layer: when SCAN_PROVIDER is clamav/virustotal the bytes are also
 * submitted to that engine. Not implemented yet, so a configured-but-unwired
 * provider fails closed rather than letting content through unscanned.
 */
export interface ScanOptions {
  avProvider: 'none' | 'clamav' | 'virustotal';
  maxBytes: number;
}

type DetectedType =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'pdf'
  | 'heic' // allowed
  | 'exe'
  | 'elf'
  | 'macho'
  | 'zip'
  | 'script'
  | 'markup'
  | 'unknown'; // rejected

const ALLOWED = new Set<DetectedType>([
  'png',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'heic',
]);

export interface ScanVerdict {
  ok: boolean;
  detected: DetectedType;
  reason?: string;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++)
    if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

export function detectType(bytes: Uint8Array): DetectedType {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return 'webp';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  // HEIC/HEIF: "ftyp" at offset 4, brand in the heif family at offset 8
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...Array.from(bytes.subarray(8, 12)));
    if (
      ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'heif'].includes(
        brand,
      )
    )
      return 'heic';
  }
  // Dangerous / disallowed
  if (startsWith(bytes, [0x4d, 0x5a])) return 'exe'; // PE (MZ)
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'elf'; // ELF
  if (
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe])
  )
    return 'macho';
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
  )
    return 'zip';
  if (startsWith(bytes, [0x23, 0x21])) return 'script'; // #!
  if (bytes.length > 0 && bytes[0] === 0x3c) return 'markup'; // '<' HTML/XML/SVG
  return 'unknown';
}

function declaredFamily(mime: string): 'image' | 'pdf' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

function detectedFamily(t: DetectedType): 'image' | 'pdf' | 'other' {
  if (t === 'pdf') return 'pdf';
  if (['png', 'jpeg', 'gif', 'webp', 'heic'].includes(t)) return 'image';
  return 'other';
}

/** Pure, dependency-free inspection. Unit-tested directly. */
export function inspectFileBytes(
  bytes: Uint8Array,
  declaredMime: string,
  maxBytes: number,
): ScanVerdict {
  if (bytes.length === 0)
    return { ok: false, detected: 'unknown', reason: 'empty file' };
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      detected: 'unknown',
      reason: `file exceeds ${maxBytes} bytes`,
    };
  }
  const detected = detectType(bytes);
  if (!ALLOWED.has(detected)) {
    return {
      ok: false,
      detected,
      reason: `disallowed or dangerous content type: ${detected}`,
    };
  }
  if (declaredFamily(declaredMime) !== detectedFamily(detected)) {
    return {
      ok: false,
      detected,
      reason: `declared MIME ${declaredMime} does not match detected ${detected}`,
    };
  }
  return { ok: true, detected };
}

export function makeScanDocumentNode(opts: ScanOptions) {
  return async function scanDocument(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};

    let bytes: Uint8Array;
    try {
      const res = await fetch(state.signedUrl);
      if (!res.ok)
        return {
          error: `Scan failed: document not retrievable (HTTP ${res.status})`,
        };
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      return {
        error: `Scan failed to download document: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }

    const verdict = inspectFileBytes(bytes, state.mimeType, opts.maxBytes);
    if (!verdict.ok) {
      safeLog.warn(
        'documents.scan',
        `rejected ${state.documentId}: ${verdict.reason} (detected ${verdict.detected})`,
      );
      return { error: `Document rejected by malware scan: ${verdict.reason}` };
    }

    if (opts.avProvider !== 'none') {
      // TODO(F3): submit `bytes` to the configured AV engine; quarantine + error
      // on a positive detection. Fail closed until implemented.
      return {
        error: `AV provider "${opts.avProvider}" is not implemented yet. Wire it before enabling.`,
      };
    }

    return {};
  };
}
