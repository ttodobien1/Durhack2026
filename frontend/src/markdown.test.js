// Self-check for the README renderer: node src/markdown.test.js
import assert from 'node:assert/strict'
import { renderMarkdown as md } from './markdown.js'

assert.equal(md('# Hi'), '<h1>Hi</h1>')
assert.equal(md('**bold** and *it* and `x<y`'), '<p><strong>bold</strong> and <em>it</em> and <code>x&lt;y</code></p>')
assert.equal(md('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>')
assert.equal(md('1. a\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>')
assert.equal(md('line one\nline two\n\nnext'), '<p>line one<br>line two</p>\n<p>next</p>')
assert.equal(md('```\n<b>\n```'), '<pre><code>&lt;b&gt;</code></pre>')
assert.equal(md('snake_case_name'), '<p>snake_case_name</p>')

// Safety: raw HTML is escaped and only safe link targets survive.
assert.equal(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
assert.equal(md('[x](javascript:alert(1))'), '<p>x)</p>') // link dropped, text kept
assert.equal(md('[x](https://a.b/"onmouseover=alert(1))'), '<p><a href="https://a.b/&quot;onmouseover=alert(1" target="_blank" rel="noopener noreferrer">x</a>)</p>')
assert.equal(md('[me](#/u/ana)'), '<p><a href="#/u/ana">me</a></p>')
console.log('markdown ok')
