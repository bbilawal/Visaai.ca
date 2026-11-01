import type { PortalFillFile, RequiredUpload } from '../shared'

/**
 * Attaching a reviewed document on IRCC /doc-upload, and on the Permanent
 * Residence Portal's application (case) page — the ONE place the extension
 * touches a file input.
 *
 * Rules, every one of them enforced here (dry run 2026-10-17):
 *  - only on the portal's document-upload page (TRV /doc-upload; PR
 *    /en/application/case/<id>, nothing after the id);
 *  - on the PR case page only a slot the applicant can SEE: IRCC renders
 *    every table two or three times for different screen widths, shows one
 *    copy, and repeats the input ids across copies and rows (live
 *    2026-10-20); the hidden copies are not slots;
 *  - PR case page only: a file whose type the input's own `accept` does not
 *    list is refused; the row's attachment cell must be there and empty
 *    before, and must name the file after (review B1);
 *  - only an `input[type=file]`, found by the TEXT of its slot's row (IRCC
 *    numbers its inputs req_upload0.. in an order that depends on the
 *    applicant's answers); exactly one row may match;
 *  - the bytes come from the server inside the signed command — never a URL —
 *    and are re-hashed and checked against the declared size, type and IRCC's
 *    5 MB / format limits before anything is set;
 *  - a slot that already shows a file is left alone (never replaced, never
 *    deleted);
 *  - it sets the input's files and fires input/change, nothing else: no
 *    click, no submit, no navigation.
 */

export const UPLOAD_SELECTOR_PREFIX = '::upload:'
export const UPLOAD_PAGE = '/doc-upload'
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/tiff': ['tif', 'tiff'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
}
// A file NAME ("cnic.jpg"), not a list of accepted formats (".jpg, .png").
const FILE_NAME = /[\w()-]\.(pdf|jpe?g|png|tiff?|docx?)\b/i

export function isUploadSelector(selector: string): boolean {
  return typeof selector === 'string' && selector.startsWith(UPLOAD_SELECTOR_PREFIX)
}

function rowPattern(selector: string): RegExp | null {
  try {
    return new RegExp(selector.slice(UPLOAD_SELECTOR_PREFIX.length), 'i')
  } catch {
    return null
  }
}

/** The block of the page that belongs to one file input: its smallest ancestor holding no other file input. */
export function uploadRowOf(input: Element): Element {
  let row: Element = input
  for (let el = input.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.querySelectorAll('input[type="file"]').length > 1) break
    row = el
  }
  return row
}

/** The label of a slot: the <label> for the input, else its row's text. */
function slotText(input: HTMLInputElement, row: Element, pr = false): string {
  // PR case page: only an id the page uses once — it repeats one id on every
  // supporting-document row (#supporting-documents-input), so a label for it
  // would name every row.
  const unique = pr
    ? !!input.id && Array.from(document.querySelectorAll('[id]')).filter((e) => e.id === input.id).length === 1
    : !!input.id
  const byFor = unique
    ? Array.from(document.querySelectorAll('label[for]')).find((l) => (l as HTMLLabelElement).htmlFor === input.id)
    : null
  const parts = [byFor?.textContent ?? '', input.getAttribute('aria-label') ?? '', row.textContent ?? '']
  return parts.join(' ').replace(/\s+/g, ' ')
}

export type UploadTarget =
  | { status: 'found'; input: HTMLInputElement; row: Element }
  | { status: 'missing' | 'ambiguous' | 'invalid' | 'wrong_page' }

/**
 * IRCC's Permanent Residence Portal application page (live 2026-10-20): the
 * forms, PDF forms, supporting documents, fee and declaration of one
 * application, at /en/application/case/<id> exactly. The form pages below it
 * (/…/imm5406, /…/imm0008/page2) are not upload pages.
 */
const PR_CASE_PAGE = /^\/(?:en|fr)\/application\/case\/\d+\/?$/i

export function onPrCasePage(path: string = location.pathname): boolean {
  return PR_CASE_PAGE.test(path)
}

export function onUploadPage(path: string = location.pathname): boolean {
  return path === UPLOAD_PAGE || path.endsWith(UPLOAD_PAGE) || onPrCasePage(path)
}

/**
 * Whether a slot's row is on the screen. CSS first (display:none or `hidden`
 * on the row or an ancestor — the file input itself is usually hidden behind
 * its "Upload" button, so it is not the one checked); then, where the page has
 * a layout (a real browser: the document has client rects; jsdom has none),
 * the row must have client rects — the PR portal's other copies of a table
 * have none (live 2026-10-20).
 */
export function rowShown(row: Element): boolean {
  const view = row.ownerDocument.defaultView
  if (!view) return false
  for (let n: Element | null = row; n; n = n.parentElement) {
    if ((n as HTMLElement).hidden) return false
    if (view.getComputedStyle(n).display === 'none') return false
  }
  const v = view.getComputedStyle(row).visibility
  if (v === 'hidden' || v === 'collapse') return false
  const hasLayout = row.ownerDocument.documentElement.getClientRects().length > 0
  if (hasLayout && row.getClientRects().length === 0) return false
  return true
}

/**
 * A slot's row: on the PR case page its table row (`tr`) when that holds this
 * input only — a table of one row would otherwise climb to the whole table,
 * headings and help text included — else the smallest block holding no other
 * file input.
 */
function slotRowOf(input: Element, pr: boolean): Element {
  if (pr) {
    const tr = input.closest('tr')
    if (tr && tr.querySelectorAll('input[type="file"]').length === 1) return tr
  }
  return uploadRowOf(input)
}

/** The one file input whose slot names this pattern, on the upload page only. */
export function findUploadInput(selector: string, path?: string): UploadTarget {
  if (!onUploadPage(path)) return { status: 'wrong_page' }
  const re = rowPattern(selector)
  if (!re) return { status: 'invalid' }
  const pr = onPrCasePage(path)
  const hits: Array<{ input: HTMLInputElement; row: Element }> = []
  for (const el of Array.from(document.querySelectorAll('input[type="file"]'))) {
    const input = el as HTMLInputElement
    if (input.disabled) continue
    const row = slotRowOf(input, pr)
    // The PR portal's hidden copies of a table are not slots.
    if (pr && !rowShown(row)) continue
    if (re.test(slotText(input, row, pr))) hits.push({ input, row })
  }
  if (hits.length === 0) return { status: 'missing' }
  if (hits.length > 1) return { status: 'ambiguous' }
  return { status: 'found', ...hits[0] }
}

/** The slot already shows a file (one the applicant or an earlier run attached). */
export function slotHasFile(input: HTMLInputElement, row: Element): boolean {
  if ((input.files?.length ?? 0) > 0) return true
  // PR case page only: its attachment cell is the row's file display.
  if (onPrCasePage() && prAttachmentState(row) !== 'empty') return true
  const text = (row.textContent ?? '').replace(/\s+/g, ' ')
  if (FILE_NAME.test(text)) return true
  // An uploaded file shows a control to remove it.
  return Array.from(row.querySelectorAll('button, a')).some((b) => /\b(delete|remove)\b/i.test(b.textContent ?? ''))
}

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toLowerCase() : ''
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export type FileCheck = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; reason: string }

/** The server's file, checked byte for byte against what it declares and what IRCC accepts. */
export async function checkFile(file: PortalFillFile | undefined): Promise<FileCheck> {
  if (!file || typeof file.base64 !== 'string' || typeof file.name !== 'string') return { ok: false, reason: 'no_file' }
  const exts = ALLOWED[file.mimeType]
  if (!exts || !exts.includes(extensionOf(file.name))) return { ok: false, reason: 'type' }
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const bin = atob(file.base64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } catch {
    return { ok: false, reason: 'encoding' }
  }
  if (bytes.length === 0 || bytes.length > UPLOAD_MAX_BYTES || bytes.length !== file.size) return { ok: false, reason: 'size' }
  if ((await sha256Hex(bytes)) !== String(file.sha256).toLowerCase()) return { ok: false, reason: 'hash' }
  return { ok: true, bytes }
}

/**
 * PR case page: the row's attachment cell (`td.documents-upload-table__
 * attachment`, empty while nothing is uploaded — live 2026-10-20). How an
 * uploaded file looks there was never recorded (review B1), so anything but
 * one cell that is plainly empty counts as not-empty.
 */
export function prAttachmentState(row: Element): 'empty' | 'filled' | 'missing' {
  const cells = row.querySelectorAll('.documents-upload-table__attachment')
  if (cells.length !== 1) return 'missing'
  const cell = cells[0]
  return (cell.textContent ?? '').trim() === '' && cell.children.length === 0 ? 'empty' : 'filled'
}

/** The PR row's attachment cell names this file (the upload is listed). */
export function prAttachmentShows(row: Element, fileName: string): boolean {
  const cells = row.querySelectorAll('.documents-upload-table__attachment')
  return cells.length === 1 && (cells[0].textContent ?? '').includes(fileName)
}

/**
 * Whether the input's own `accept` list takes this file (the PR portal's PDF
 * form slots: "application/pdf"). No `accept`: anything checkFile allowed.
 */
export function inputAccepts(input: HTMLInputElement, file: Pick<PortalFillFile, 'name' | 'mimeType'>): boolean {
  const accept = (input.getAttribute('accept') ?? '').trim()
  if (!accept) return true
  const mime = file.mimeType.toLowerCase()
  const ext = extensionOf(file.name)
  return accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .some((t) => (t.startsWith('.') ? t.slice(1) === ext : t.endsWith('/*') ? mime.startsWith(t.slice(0, -1)) : t === mime))
}

/** Put the file on the input the way a user's file picker would, and announce it. */
export function setFile(input: HTMLInputElement, file: PortalFillFile, bytes: Uint8Array<ArrayBuffer>): boolean {
  if (input.type !== 'file') return false
  const f = new File([bytes], file.name, { type: file.mimeType })
  const dt = new DataTransfer()
  dt.items.add(f)
  input.files = dt.files
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

/** The portal took the file: the input holds it, or the row now names it. */
export function fileTaken(input: HTMLInputElement, row: Element, file: PortalFillFile): boolean {
  const held = input.files?.[0]
  if (held && held.name === file.name && held.size === file.size) return true
  return (row.textContent ?? '').includes(file.name)
}

/**
 * The REQUIRED slots on the upload page (IRCC numbers them req_upload0..; the
 * optional ones are opt_upload0..) with the status IRCC shows for each.
 * Read-only. IRCC will not let the applicant pay while one is not uploaded.
 */
export function requiredUploads(path?: string): RequiredUpload[] {
  if (!onUploadPage(path)) return []
  if (onPrCasePage(path)) return prRequiredUploads()
  const out: RequiredUpload[] = []
  for (const el of Array.from(document.querySelectorAll('input[type="file"][id^="req_upload"]'))) {
    const row = el.closest('tr') ?? uploadRowOf(el)
    const label = row.querySelector('a.collapsible')
    const name = (
      label
        ? Array.from(label.childNodes)
            .filter((n) => !(n.nodeType === 1 && (n as Element).tagName === 'MAT-ICON'))
            .map((n) => n.textContent ?? '')
            .join(' ')
        : ''
    )
      .replace(/\s+/g, ' ')
      .trim()
    const status = (row.querySelector('td')?.textContent ?? '').replace(/\s+/g, ' ')
    const uploaded = /not uploaded/i.test(status) ? false : /uploaded/i.test(status) || slotHasFile(el as HTMLInputElement, row)
    out.push({ name: name || 'A required document', uploaded })
  }
  return out
}

/**
 * PR case page: the visible rows marked "(required)" that take a file (PDF
 * forms, supporting documents, proof of payment), named by the text before
 * "(required)". Read-only. Uploaded = the row shows a file (slotHasFile).
 */
function prRequiredUploads(): RequiredUpload[] {
  const out: RequiredUpload[] = []
  const seen = new Set<Element>()
  for (const el of Array.from(document.querySelectorAll('input[type="file"]'))) {
    const input = el as HTMLInputElement
    const row = slotRowOf(input, true)
    if (seen.has(row) || !rowShown(row)) continue
    seen.add(row)
    const text = (row.textContent ?? '').replace(/\s+/g, ' ').trim()
    const m = /^(.*?)\(required\)/i.exec(text)
    if (!m) continue
    const name = m[1].replace(/^[\s*]+/, '').replace(/\s+/g, ' ').trim()
    out.push({ name: name || 'A required document', uploaded: slotHasFile(input, row) })
  }
  return out
}
