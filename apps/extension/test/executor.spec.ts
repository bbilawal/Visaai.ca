// This suite had not run since it was written: `node:crypto` needs @types/node,
// which is not a dependency of the extension package, so ts-jest failed the
// whole file to COMPILE and jest reported "0 tests" rather than a failure
// anyone would read as one. Reaching the builtin through a declared require
// keeps the suite alive without pulling Node's type surface into an extension
// that targets the browser.
declare function require(id: string): unknown
const { createHash } = require('crypto') as {
  createHash: (alg: string) => {
    update: (data: string, enc: string) => { digest: (enc: string) => string }
  }
}
import { executeWrite } from '../src/executor/field-executor'
import { isSafeWriteTarget } from '../src/executor/safety-guards'
import { readField } from '../src/executor/readback'
import { verifyField } from '../src/readback-engine'

const ref = (v: string) => createHash('sha256').update(v.trim().normalize('NFC'), 'utf8').digest('hex')

beforeEach(() => {
  document.body.innerHTML = `
    <input id="dob" type="text" />
    <input id="pw" type="password" />
    <input id="file" type="file" />
    <button id="go" type="submit">Go</button>
    <input id="ro" type="text" readonly />`
})

describe('Extension executor (jsdom) — the only DOM writer', () => {
  it('writes the value + fires input/change, returns the node', () => {
    const el = document.querySelector('#dob') as HTMLInputElement
    const fired: string[] = []
    el.addEventListener('input', () => fired.push('input'))
    el.addEventListener('change', () => fired.push('change'))

    const out = executeWrite('#dob', '2031-03-14')
    expect(out.written).toBe(true)
    expect(el.value).toBe('2031-03-14')
    expect(fired).toEqual(['input', 'change'])
    expect(out.node).toBe(el)
  })

  it('refuses unsafe targets (submit/file/password/readonly)', () => {
    for (const sel of ['#go', '#file', '#pw', '#ro']) {
      const el = document.querySelector(sel) as Element
      expect(isSafeWriteTarget(el)).toBe(false)
      expect(executeWrite(sel, 'x')).toMatchObject({ written: false, reason: 'unsafe_target' })
    }
  })

  it('selector_missing when the field is absent', () => {
    expect(executeWrite('#nope', 'x')).toMatchObject({ written: false, reason: 'selector_missing' })
  })

  it('write -> readback -> verify round trip VERIFIES against the value hash', async () => {
    executeWrite('#dob', '2031-03-14')
    const rb = await readField('#dob', undefined, 0)
    expect(rb.found).toBe(true)
    expect(rb.value).toBe('2031-03-14')
    const result = await verifyField(rb.value, ref('2031-03-14'))
    expect(result.outcome).toBe('verified')
  })

  it('readback normalizes (trim+NFC) so a padded write still verifies', async () => {
    executeWrite('#dob', '  2031-03-14  ')
    const rb = await readField('#dob', undefined, 0)
    expect(rb.value).toBe('2031-03-14') // trimmed
    expect((await verifyField(rb.value, ref('2031-03-14'))).outcome).toBe('verified')
  })

  it('a wrong expected hash fails as value_mismatch (spoof/drift detection)', async () => {
    executeWrite('#dob', 'X1234567')
    const rb = await readField('#dob', undefined, 0)
    expect((await verifyField(rb.value, ref('DIFFERENT'))).outcome).toBe('failed')
  })

  it('portal_mutation: readback node differs from the written node', async () => {
    const out = executeWrite('#dob', 'X1234567')
    // simulate the portal replacing the node after the write
    const fresh = document.createElement('input')
    fresh.id = 'dob'
    ;(document.querySelector('#dob') as HTMLInputElement).replaceWith(fresh)
    const rb = await readField('#dob', out.node, 0)
    expect(rb.found).toBe(true)
    expect(rb.sameNode).toBe(false)
  })
})
