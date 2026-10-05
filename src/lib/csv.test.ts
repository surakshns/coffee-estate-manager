import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from './csv'

describe('CSV backup round trips', () => {
  it('preserves multiline notes, commas, quotes, whitespace and Unicode', () => {
    const rows = [{ name: '  ಕೃಷಿ, Estate  ', notes: 'First line\r\n"Quoted" second line\nThird', amount: 12.34, empty: null }]
    expect(parseCsv('\uFEFF' + toCsv(rows))).toEqual([{ name: rows[0].name, notes: rows[0].notes, amount: '12.34', empty: '' }])
  })
  it.each(['=HYPERLINK("https://example.com")', '+123', '-2+3', '@SUM(A1)', '  =1+1', '\tFormula', '\rFormula', "'existing note"])('escapes spreadsheet text formulas and restores %j', text => {
    const csv = toCsv([{ notes: text, amount: -12 }])
    expect(csv.split('\r\n')[1].startsWith('"\'')).toBe(true)
    expect(parseCsv(csv)).toEqual([{ notes: text, amount: '-12' }])
  })
  it('supports unquoted files and CRLF without trimming record text', () => {
    expect(parseCsv('name,notes\r\nAsha, hello \r\n\r\n')).toEqual([{ name: 'Asha', notes: ' hello ' }])
    expect(parseCsv('')).toEqual([])
    expect(toCsv([])).toBe('')
  })
  it.each(['a,a\n1,2', 'a,\n1,2', 'a,b\n1', 'a,b\n1,2,3', 'a,b\n"unfinished,2', 'a,b\n"x"oops,2', 'a,b\nhe"llo,2'])('rejects malformed CSV before an import: %j', text => {
    expect(() => parseCsv(text)).toThrow()
  })
})
