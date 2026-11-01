import { rowSummaryPresent } from '../src/executor/row-match'

/** Live 2026-10-18 tables: a filled page refilled must not add the row twice. */
describe('row summaries of the new IRCC rows', () => {
  it('a trip row: "<country> <from> to <to>"', () => {
    const rows = ['From 2023-01 To 2023-02 Country or territory United Arab Emirates City Dubai Purpose Tourism edit Edit delete_forever Delete']
    expect(rowSummaryPresent('United Arab Emirates 2023-01 to 2023-02', rows)).toBe(true)
  })
  it('the current job: "<employer> since <YYYY-MM>"', () => {
    const rows = ['Work or Activity Natural and applied sciences Job title Computer and information systems professionals Company or employer Infosys From 2015-03 To Country India edit Edit']
    expect(rowSummaryPresent('Infosys since 2015-03', rows)).toBe(true)
  })
  it('an open-ended row: "<name> <from> to now" matches IRCC\'s blank To (live 2026-10-31)', () => {
    const rows = ['Management occupations Managers in customer and personal services Max Care car wash and auto detailing 2025-08 Pakistan edit Edit delete_forever Delete']
    expect(rowSummaryPresent('Max Care car wash and auto detailing 2025-08 to now', rows)).toBe(true)
    expect(rowSummaryPresent('Max Care car wash and auto detailing 2024-08 to now', rows)).toBe(false)
    expect(rowSummaryPresent('Other Employer 2025-08 to now', rows)).toBe(false)
  })
  it('a different trip is not mistaken for it', () => {
    const rows = ['From 2022-05 To 2022-06 Country or territory Qatar City Doha']
    expect(rowSummaryPresent('United Arab Emirates 2023-01 to 2023-02', rows)).toBe(false)
  })
  it('a same-month trip is not a trip that only ends that month', () => {
    const rows = ['From 2022-04 To 2022-05 Country or territory Thailand City Thailand Purpose tourism edit Edit delete_forever Delete']
    expect(rowSummaryPresent('Thailand 2022-05 to 2022-05', rows)).toBe(false)
    expect(rowSummaryPresent('Thailand 2022-04 to 2022-05', rows)).toBe(true)
  })
  it('a same-month trip matches its own row', () => {
    const rows = ['From 2022-05 To 2022-05 Country or territory Thailand City Thailand Purpose tourism edit Edit delete_forever Delete']
    expect(rowSummaryPresent('Thailand 2022-05 to 2022-05', rows)).toBe(true)
  })
  it('a repeated name matches the row that shows it in two columns', () => {
    expect(rowSummaryPresent('Ali Ali (Son, born 2001-01-01)', ['Ali Ali 2001-01-01 Son Pakistan'])).toBe(true)
    expect(rowSummaryPresent('Ali Ali (Son, born 2001-01-01)', ['Ali Khan 2001-01-01 Son Pakistan'])).toBe(false)
  })
  it('a person born in a known year only matches the row IRCC shows as 2000-**-**', () => {
    const rows = ['Talha Mian 2000-**-** Son Pakistan edit Edit delete_forever Delete']
    expect(rowSummaryPresent('Mian Talha (Son, born 2000-**-**)', rows)).toBe(true)
    expect(rowSummaryPresent('Mian Talha (Son, born 2001-**-**)', rows)).toBe(false)
    expect(rowSummaryPresent('Mian Talha (Son, born 2000-**-**)', ['Talha Mian 2000-05-12 Son Pakistan'])).toBe(false)
  })
})
