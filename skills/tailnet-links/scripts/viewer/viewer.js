import { marked } from './marked.esm.js'

const MERMAID_MODULE =
	'https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.esm.min.mjs'
const DIAGRAM_SELECTOR = 'pre > code.language-mermaid'

async function drawDiagrams(article) {
	const blocks = [...article.querySelectorAll(DIAGRAM_SELECTOR)]
	if (!blocks.length) return
	const diagrams = blocks.map(block => {
		const diagram = document.createElement('pre')
		diagram.className = 'mermaid'
		diagram.textContent = block.textContent
		block.parentElement.replaceWith(diagram)
		return diagram
	})
	const { default: mermaid } = await import(MERMAID_MODULE)
	const isDark = matchMedia('(prefers-color-scheme: dark)').matches
	mermaid.initialize({
		startOnLoad: false,
		theme: isDark ? 'dark' : 'default',
	})
	await mermaid.run({ nodes: diagrams })
}

async function render() {
	const article = document.getElementById('document')
	const response = await fetch(`${location.pathname}?raw`)
	if (!response.ok) {
		article.textContent = `This document could not be loaded (HTTP ${response.status}).`
		return
	}
	article.innerHTML = marked.parse(await response.text())
	const title = article.querySelector('h1')
	if (title) document.title = title.textContent
	await drawDiagrams(article)
}

await render()
