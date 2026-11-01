import { Fragment, type ReactNode } from 'react'

/**
 * Minimal, SAFE markdown renderer for generated letters (LOE, itinerary, cover
 * letter). Builds React elements only — no dangerouslySetInnerHTML — so any
 * HTML in the source is shown as text, never parsed.
 *
 * Supports what the generators emit: #/##/### headings, paragraphs, hard line
 * breaks, `-`/`*` and `1.` lists, `---` rules, **bold**, *italic* / _italic_,
 * `code`, [links](url) (shown as their text — never a live link), `>` quotes
 * and GitHub-style pipe tables.
 */

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]*\))/g

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('**') || tok.startsWith('__')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) out.push(...inline(tok.slice(1, tok.indexOf('](')), key))
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    last = start + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Paragraph lines joined with <br/> (generators use "two trailing spaces" breaks). */
function lines(ls: string[], keyBase: string): ReactNode[] {
  return ls.map((l, i) => (
    <Fragment key={`${keyBase}-${i}`}>
      {i > 0 && <br />}
      {inline(l.replace(/\s+$/, ''), `${keyBase}-${i}`)}
    </Fragment>
  ))
}

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

const CELL_STYLE = { border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))', padding: '4px 8px', textAlign: 'left' as const, verticalAlign: 'top' as const }

function table(rows: string[], key: string): ReactNode {
  const [head, , ...body] = rows
  return (
    <div key={key} style={{ overflowX: 'auto', margin: '0 0 0.75em' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{cells(head).map((c, i) => <th key={i} style={{ ...CELL_STYLE, fontWeight: 600 }}>{inline(c, `${key}-h${i}`)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>{cells(r).map((c, i) => <td key={i} style={CELL_STYLE}>{inline(c, `${key}-${ri}-${i}`)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const blocks: ReactNode[] = []
  const src = source.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flush = () => {
    const k = `b${blocks.length}`
    if (para.length) {
      blocks.push(<p key={k} style={{ margin: '0 0 0.75em' }}>{lines(para, k)}</p>)
      para = []
    }
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `${k}-li${i}`)}</li>)
      blocks.push(list.ordered
        ? <ol key={`${k}l`} style={{ margin: '0 0 0.75em', paddingLeft: '1.4em', listStyle: 'decimal' }}>{items}</ol>
        : <ul key={`${k}l`} style={{ margin: '0 0 0.75em', paddingLeft: '1.4em', listStyle: 'disc' }}>{items}</ul>)
      list = null
    }
  }

  for (let n = 0; n < src.length; n++) {
    const raw = src[n]
    const line = raw.trimEnd()
    if (TABLE_ROW.test(line) && n + 1 < src.length && TABLE_SEP.test(src[n + 1])) {
      flush()
      const rows = [line, src[n + 1]]
      n += 2
      while (n < src.length && TABLE_ROW.test(src[n])) rows.push(src[n++])
      n--
      blocks.push(table(rows, `b${blocks.length}`))
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) { if (list) flush(); para.push(quote[1]); continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (!line.trim()) { flush(); continue }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); blocks.push(<hr key={`b${blocks.length}`} />); continue }
    if (h) {
      flush()
      const level = Math.min(h[1].length, 3)
      const Tag = (`h${level}` as 'h1' | 'h2' | 'h3')
      blocks.push(<Tag key={`b${blocks.length}`} style={{ margin: '0.6em 0 0.4em', fontWeight: 600 }}>{inline(h[2], `h${blocks.length}`)}</Tag>)
      continue
    }
    if (ul || ol) {
      const ordered = Boolean(ol && !ul)
      if (para.length || (list && list.ordered !== ordered)) flush()
      if (!list) list = { ordered, items: [] }
      list.items.push((ul ?? ol)![1])
      continue
    }
    if (list) flush()
    para.push(raw)
  }
  flush()

  return <div className={className}>{blocks}</div>
}
