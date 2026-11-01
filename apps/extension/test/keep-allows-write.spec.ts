import { keepAllowsWrite } from '../src/executor/field-executor'

/**
 * Live 2026-10-21, IRCC PR portal IMM 5669 Section H: the run stopped at
 * "Address 1 — from" (value_mismatch) because an empty masked date box holds
 * "____/__", and the portal pre-fills the current address with "null " before
 * the street when there is no street number.
 */
describe('keepAllowsWrite', () => {
  it('an empty or mask-only box may be written', () => {
    expect(keepAllowsWrite('', '2016/10')).toBe(true)
    expect(keepAllowsWrite('  ', '2016/10')).toBe(true)
    expect(keepAllowsWrite('____/__', '2016/10')).toBe(true)
    expect(keepAllowsWrite('____/__/__', '2016/10/01')).toBe(true)
  })
  it('the same value may be written again', () => {
    expect(keepAllowsWrite('Gujrat', 'Gujrat')).toBe(true)
    expect(keepAllowsWrite(' Gujrat ', 'Gujrat')).toBe(true)
  })
  it("IRCC's \"null \" street prefix is the same street", () => {
    expect(keepAllowsWrite('null Jaffery Town, Bhimber Road', 'Jaffery Town, Bhimber Road')).toBe(true)
    expect(keepAllowsWrite('null Jaffery Town', 'Another Street')).toBe(false)
  })
  it("anything else the box holds is the applicant's and is kept", () => {
    expect(keepAllowsWrite('2015/01', '2016/10')).toBe(false)
    expect(keepAllowsWrite('12 Main St', 'Jaffery Town')).toBe(false)
    expect(keepAllowsWrite('2016/1_', '2016/10')).toBe(false)
    // A placeholder the applicant typed is theirs, not a mask.
    expect(keepAllowsWrite('-', 'X')).toBe(false)
    expect(keepAllowsWrite('.', 'X')).toBe(false)
  })
})
