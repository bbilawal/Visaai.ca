/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillFile, type PortalFillWriteCommand } from '../src/shared'
import { checkFile, findUploadInput, requiredUploads, slotHasFile } from '../src/executor/file-attach'

/**
 * Dry run 2026-10-17: the assistant attaches the applicant's reviewed VisaAI
 * documents on IRCC /doc-upload — file inputs only, on that page only, bytes
 * from the server only, empty slots only.
 */

// jsdom has File but no DataTransfer: the smallest stand-in a file input accepts.
class FakeDataTransfer {
  private list: File[] = []
  items = { add: (f: File) => this.list.push(f) }
  get files(): FileList {
    const l = this.list
    return Object.assign([...l], { item: (i: number) => l[i] ?? null }) as unknown as FileList
  }
}
;(globalThis as any).DataTransfer = FakeDataTransfer

// Precomputed so the fixture needs no hashing: sha256('%PDF-1.4 test').
const PDF_TEXT = '%PDF-1.4 test'
let PDF_SHA = ''
beforeAll(async () => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PDF_TEXT))
  PDF_SHA = Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
})
function makeFile(text = PDF_TEXT, name = 'Passport.pdf', mimeType = 'application/pdf'): PortalFillFile {
  return { name, mimeType, size: text.length, sha256: PDF_SHA, base64: btoa(text) }
}

function page(path = '/doc-upload') {
  window.history.replaceState({}, '', path)
  document.body.innerHTML = `
    <main>
      <div class="row"><label for="req_upload0_file_input">National identity document (required)</label>
        <input type="file" id="req_upload0_file_input" /></div>
      <div class="row"><span>Passport (required)</span><input type="file" id="req_upload1_file_input" /></div>
      <div class="row"><span>Proof of financial support</span><p>Accepted formats: .pdf, .jpg</p>
        <input type="file" id="req_upload2_file_input" /></div>
      <div class="row"><span>Use of a Representative (IMM 5476)</span><a>IMM5476_signed.pdf</a><button>Delete</button>
        <input type="file" id="req_upload3_file_input" /></div>
      <button id="next_path">Save and continue</button>
    </main>`
  // IRCC replaces the input's native file display: let `files` be settable.
  for (const el of Array.from(document.querySelectorAll('input[type=file]'))) {
    let files: FileList | null = null
    Object.defineProperty(el, 'files', { get: () => files, set: (v) => (files = v), configurable: true })
  }
}

describe('finding the slot', () => {
  beforeEach(() => page())

  it('finds the one file input whose row names the slot', () => {
    const t = findUploadInput('::upload:\\bpassport\\b')
    expect(t.status === 'found' && t.input.id).toBe('req_upload1_file_input')
    const id = findUploadInput('::upload:national identity|identity document')
    expect(id.status === 'found' && id.input.id).toBe('req_upload0_file_input')
  })

  it('refuses anywhere but the upload page', () => {
    page('/finances')
    expect(findUploadInput('::upload:\\bpassport\\b').status).toBe('wrong_page')
  })

  it('two rows matching is ambiguous, not a guess', () => {
    expect(findUploadInput('::upload:required').status).toBe('ambiguous')
  })

  it('a formats hint is not a file; a named file or a Delete control is', () => {
    const funds = findUploadInput('::upload:financial')
    const rep = findUploadInput('::upload:representative|5476')
    if (funds.status !== 'found' || rep.status !== 'found') throw new Error('slots')
    expect(slotHasFile(funds.input, funds.row)).toBe(false)
    expect(slotHasFile(rep.input, rep.row)).toBe(true)
  })
})

describe('checking the file before anything is set', () => {
  it('accepts the declared bytes', async () => {
    expect((await checkFile(makeFile())).ok).toBe(true)
  })
  it('refuses a hash, size or type that does not match', async () => {
    expect(await checkFile({ ...makeFile(), sha256: 'f'.repeat(64) })).toEqual({ ok: false, reason: 'hash' })
    expect(await checkFile({ ...makeFile(), size: 3 })).toEqual({ ok: false, reason: 'size' })
    expect(await checkFile(makeFile('GIF89a', 'x.gif', 'image/gif'))).toEqual({ ok: false, reason: 'type' })
    expect(await checkFile(makeFile('%PDF', 'x.exe', 'application/pdf'))).toEqual({ ok: false, reason: 'type' })
    expect(await checkFile(undefined)).toEqual({ ok: false, reason: 'no_file' })
  })
})

describe('attach_file through the content script', () => {
  let mock: ChromeMock
  const h = (v: string) => hashValue(normalizeValue(v))
  async function cmd(over: Partial<PortalFillWriteCommand>): Promise<PortalFillWriteCommand> {
    const mappedValue = 'Passport.pdf [doc:00000000-0000-4000-8000-000000000002]'
    return {
      protocol: PORTAL_FILL_PROTOCOL_VERSION,
      kind: 'write',
      executionId: 'e',
      fieldKey: 'ircc_upload_passport',
      selector: '::upload:\\bpassport\\b',
      mappedValue,
      expectedValueHash: await h(mappedValue),
      op: 'attach_file',
      file: makeFile(),
      ...over,
    }
  }
  const run = (c: PortalFillWriteCommand) =>
    deliver(mock.listeners.onMessage, { type: 'execute-field-intent', command: c }, undefined, 9000) as Promise<{ outcome: string; reason?: string }>

  beforeEach(() => {
    page()
    mock = installChromeMock()
    jest.isolateModules(() => {
      require('../src/content')
    })
  })

  it('puts the file on the slot\'s input, announces it, and verifies the input holds it', async () => {
    const input = document.getElementById('req_upload1_file_input') as HTMLInputElement
    const seen: string[] = []
    input.addEventListener('change', () => seen.push('change'))
    expect((await run(await cmd({}))).outcome).toBe('verified')
    expect(input.files?.[0]?.name).toBe('Passport.pdf')
    expect(seen).toEqual(['change'])
  })

  it('leaves a slot that already holds a file alone', async () => {
    const r = await run(await cmd({ selector: '::upload:representative|5476', fieldKey: 'ircc_upload_representative' }))
    expect(r.outcome).toBe('verified')
    expect((document.getElementById('req_upload3_file_input') as HTMLInputElement).files).toBeNull()
  })

  it('a file that fails its checks is never set', async () => {
    const r = await run(await cmd({ file: { ...makeFile(), sha256: '0'.repeat(64) } }))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'controlled_rejected' })
    expect((document.getElementById('req_upload1_file_input') as HTMLInputElement).files).toBeNull()
  })

  it('never clicks anything (Save and continue stays untouched)', async () => {
    let clicked = false
    document.getElementById('next_path')!.addEventListener('click', () => (clicked = true))
    await run(await cmd({}))
    expect(clicked).toBe(false)
  })

  it('the probe reports a slot present on the upload page, read only', async () => {
    const res = (await deliver(mock.listeners.onMessage, { type: 'readback', selectors: ['::upload:\\bpassport\\b', '::upload:nothing-like-this'], ops: ['attach_file', 'attach_file'] })) as Array<{ found: boolean }>
    expect(res.map((r) => r.found)).toEqual([true, false])
  })
})

describe('requiredUploads (IRCC /doc-upload, markup recorded 2026-10-17)', () => {
  const row = (i: number, name: string, status: string, kind = 'req') => `
    <tr id="${kind === 'req' ? 'supportingDoc' : 'optDocs'}_row_${i}">
      <td><span class="responsiveHeading">Status</span> ${status} </td>
      <td><span class="responsiveHeading">Document name</span>
        <a class="collapsible"><mat-icon>chevron_right</mat-icon>${name}</a></td>
      <td><input type="file" id="${kind}_upload${i}_file_input" /></td>
    </tr>`

  it('lists each required slot with its status, never the optional ones', () => {
    document.body.innerHTML = `<table>${row(0, 'Passport or travel document', 'Uploaded')}${row(
      1,
      'Use of representative IMM5476',
      'Not uploaded',
    )}${row(0, 'Additional documents', 'Not uploaded', 'opt')}</table>`
    expect(requiredUploads('/doc-upload')).toEqual([
      { name: 'Passport or travel document', uploaded: true },
      { name: 'Use of representative IMM5476', uploaded: false },
    ])
  })

  it('reads nothing off the upload page', () => {
    document.body.innerHTML = `<table>${row(0, 'Passport', 'Not uploaded')}</table>`
    expect(requiredUploads('/purpose')).toEqual([])
  })
})
