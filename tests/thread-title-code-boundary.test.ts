import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
	highlightTitles,
	titlePattern,
} from '../extensions/ui/thread-titles/title-highlight.ts'

const pattern = titlePattern(['Multi API', 'API'])
const mark = (title: string): string => `<${title}>`
const highlight = (markdown: string): string => {
	assert.ok(pattern)
	return highlightTitles(markdown, pattern, mark)
}

test('leaves an indented code block inside a list item as written', () => {
	const markdown = '- item\n\n      Multi API\n\n  After Multi API.\n'
	assert.equal(
		highlight(markdown),
		'- item\n\n      Multi API\n\n  After <Multi API>.\n',
	)
})

test('leaves an indented code block inside a blockquote as written', () => {
	const markdown = '>     Multi API\n>\n> Then Multi API.\n'
	assert.equal(
		highlight(markdown),
		'>     Multi API\n>\n> Then <Multi API>.\n',
	)
})

test('does not read an escaped backtick as a code span boundary', () => {
	assert.equal(
		highlight('A \\` before Multi API and `x` after.\n'),
		'A \\` before <Multi API> and `x` after.\n',
	)
})

test('closes a fence only on a closing fence line', () => {
	const markdown = '> ```text\n> Multi API\n> ```not-a-close\n> API\n> ```\n'
	assert.equal(highlight(markdown), markdown)
})

test('leaves a link destination as written and styles its label', () => {
	assert.equal(
		highlight('[Multi API docs](https://example.test/API)\n'),
		'[<Multi API> docs](https://example.test/API)\n',
	)
})
