export function toCsv<T extends Record<string, unknown>>(rows: T[]) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (value: unknown) => {
    let text = String(value ?? '')
    // Quotes alone do not stop a spreadsheet from executing a text formula.
    // Escape leading apostrophes too, so our import can restore text exactly.
    if (typeof value === 'string' && (text.startsWith("'") || /^[\s]*[=+\-@\t\r]/.test(text))) text = "'" + text
    return `"${text.replaceAll('"', '""')}"`
  }
  return [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\r\n')
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, '')
  const records: string[][] = []
  let row: string[] = [], cell = '', quoted = false, closed = false
  const pushCell = () => { row.push(cell); cell = ''; closed = false }
  const pushRow = () => { pushCell(); if (row.some(value => value !== '')) records.push(row); row = [] }
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index++ }
      else if (character === '"') { quoted = false; closed = true }
      else cell += character
    } else if (character === ',') pushCell()
    else if (character === '\n' || character === '\r') { pushRow(); if (character === '\r' && source[index + 1] === '\n') index++ }
    else if (character === '"' && !cell && !closed) quoted = true
    else if (closed || character === '"') throw new Error('Invalid CSV quoting. Use a CSV exported from this app.')
    else cell += character
  }
  if (quoted) throw new Error('The CSV has an unfinished quoted field.')
  if (cell || row.length || closed) pushRow()
  if (!records.length) return []
  const headers = records.shift()!.map(value => value.trim())
  if (headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error('CSV column names must be present and unique.')
  const restore = (value: string) => value.startsWith("''") || /^'[\s]*[=+\-@\t\r]/.test(value) ? value.slice(1) : value
  return records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}.`)
    return Object.fromEntries(headers.map((header, column) => [header, restore(values[column])]))
  })
}
