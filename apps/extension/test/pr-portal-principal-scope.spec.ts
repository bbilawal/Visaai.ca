import { resolveTarget } from '../src/executor/resolve-target'

/**
 * IRCC Permanent Residence Portal (live 2026-10-20): every person on the
 * application has their own IMM 5406 / IMM 5669 at the same path with the
 * same ids. Only Section A's disabled, checked radio says whose form it is.
 * The API scopes each write to `body:has(#principalAppYes:checked) …`, so a
 * dependant's form resolves to nothing and is never written.
 */
const GUARD = 'body:has(#principalAppYes:checked)'
const form = (principal: boolean) => `
  <input type="radio" id="principalAppYes" name="radio-principal-applicant" disabled ${principal ? 'checked' : ''}>
  <input type="radio" id="principalAppNo" name="radio-principal-applicant" disabled ${principal ? '' : 'checked'}>
  <input id="applicantBirthplace">`

describe('PR portal: writes only on the principal applicant’s own form', () => {
  it("the principal's form resolves the field", () => {
    document.body.innerHTML = form(true)
    expect(resolveTarget(`${GUARD} #applicantBirthplace`).status).toBe('found')
  })

  it("a dependant's form resolves nothing", () => {
    document.body.innerHTML = form(false)
    expect(resolveTarget(`${GUARD} #applicantBirthplace`).status).toBe('missing')
  })

  it('a section with no marker resolves nothing', () => {
    document.body.innerHTML = '<input id="applicantBirthplace">'
    expect(resolveTarget(`${GUARD} #applicantBirthplace`).status).toBe('missing')
  })
})
