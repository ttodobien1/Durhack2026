// Tiny Markdown subset for profile READMEs: headings, paragraphs, lists, quotes, code, rules, bold, italic, links.
// Safe by construction: everything is HTML-escaped first, and links only keep http(s), mailto and in-app "#/" targets.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])[*_]([^*_]+)[*_](?![*\w])/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) =>
      /^(https?:\/\/|mailto:|#\/)/i.test(href) ? `<a href="${href}"${href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${text}</a>` : text,
    )
}

export function renderMarkdown(src = '') {
  const out = []
  let list = null // 'ul' | 'ol'
  let para = []
  let code = null
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para = []
    if (list) out.push(`</${list}>`)
    list = null
  }
  for (const line of src.replace(/\r/g, '').split('\n')) {
    if (code) {
      if (line.startsWith('```')) {
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
        code = null
      } else code.push(line)
      continue
    }
    let m
    if (line.startsWith('```')) (flush(), (code = []))
    else if ((m = line.match(/^(#{1,3})\s+(.*)/))) (flush(), out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`))
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) (flush(), out.push('<hr>'))
    else if ((m = line.match(/^\s*([-*]|\d+\.)\s+(.*)/))) {
      const kind = /\d/.test(m[1]) ? 'ol' : 'ul'
      if (para.length || list !== kind) flush()
      if (!list) out.push(`<${(list = kind)}>`)
      out.push(`<li>${inline(m[2])}</li>`)
    } else if ((m = line.match(/^>\s?(.*)/))) (flush(), out.push(`<blockquote>${inline(m[1])}</blockquote>`))
    else if (!line.trim()) flush()
    else {
      if (list) flush()
      para.push(line)
    }
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
  flush()
  return out.join('\n')
}
