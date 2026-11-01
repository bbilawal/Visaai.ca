import { executeWrite } from '../src/executor/field-executor'
import { isSafeWriteTarget } from '../src/executor/safety-guards'

/**
 * REVIEW_HANDOFF §27.7 item 56. The product's stated invariant is that the
 * applicant reviews every value before they submit. A value written into a
 * field they cannot see is one they cannot review — and on a government form
 * a hidden input is exactly where a value is carried to the server unseen.
 * `safety-guards.ts` is a denylist that omitted `type="hidden"` and had no
 * visibility check at all.
 */

beforeEach(() => {
  document.body.innerHTML = `
    <input id="visible" type="text" />
    <input id="hiddenType" type="hidden" />
    <input id="hiddenUpper" type="HIDDEN" />
    <input id="hiddenAttr" type="text" hidden />
    <input id="displayNone" type="text" style="display: none" />
    <input id="visHidden" type="text" style="visibility: hidden" />
    <div style="display: none"><input id="inHiddenParent" type="text" /></div>
    <div hidden><textarea id="inHiddenAttrParent"></textarea></div>
    <select id="hiddenSelect" style="display:none"><option value="a">a</option></select>
    <select id="visibleSelect"><option value="a">a</option></select>`
})

describe('56 — never write a value the applicant cannot see', () => {
  it.each([
    'hiddenType',
    'hiddenUpper',
    'hiddenAttr',
    'displayNone',
    'visHidden',
    'inHiddenParent',
    'inHiddenAttrParent',
    'hiddenSelect',
  ])('refuses #%s', (id) => {
    const el = document.getElementById(id) as HTMLInputElement
    expect(isSafeWriteTarget(el)).toBe(false)
    expect(executeWrite(`#${id}`, 'X1234567')).toMatchObject({ written: false, reason: 'unsafe_target' })
    expect(el.value).not.toBe('X1234567')
  })

  it.each(['visible', 'visibleSelect'])('still writes visible #%s', (id) => {
    expect(isSafeWriteTarget(document.getElementById(id) as Element)).toBe(true)
    expect(executeWrite(`#${id}`, 'a')).toMatchObject({ written: true })
  })
})
