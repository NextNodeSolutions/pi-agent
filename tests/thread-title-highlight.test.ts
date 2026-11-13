import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
	highlightTitles,
	titlePattern,
} from '../extensions/ui/thread-titles/title-highlight.ts'

const pattern = titlePattern([
	'Multi API',
	'Honor Chat Test Consent',
	'Multi API MVP Split',
])
const mark = (title: string): string => `<${title}>`
const highlight = (markdown: string): string => {
	assert.ok(pattern)
	return highlightTitles(markdown, pattern, mark)
}

test('styles a title in a paragraph, a list item, a table cell and a heading, not the project after it', () => {
	const markdown = [
		'## Honor Chat Test Consent',
		'',
		'Ask Multi API MVP Split (pi-agent) first.',
		'',
		'- Honor Chat Test Consent is working.',
		'',
		'| Thread | State |',
		'| --- | --- |',
		'| Multi API MVP Split | idle |',
		'',
	].join('\n')
	assert.equal(
		highlight(markdown),
		[
			'## <Honor Chat Test Consent>',
			'',
			'Ask <Multi API MVP Split> (pi-agent) first.',
			'',
			'- <Honor Chat Test Consent> is working.',
			'',
			'| Thread | State |',
			'| --- | --- |',
			'| <Multi API MVP Split> | idle |',
			'',
		].join('\n'),
	)
})

test('leaves inline code spans as written, including double-backtick spans', () => {
	assert.equal(
		highlight(
			'Run `hc get Multi API` then ``Multi API ` x`` for Multi API.',
		),
		'Run `hc get Multi API` then ``Multi API ` x`` for <Multi API>.',
	)
})

test('leaves fenced code blocks as written, at the top level and inside a list item', () => {
	const markdown = [
		'Before Multi API.',
		'',
		'```text',
		'Multi API MVP Split',
		'```',
		'',
		'- item',
		'',
		'  ~~~',
		'  Honor Chat Test Consent',
		'  ~~~',
		'',
		'After Multi API.',
		'',
	].join('\n')
	assert.equal(
		highlight(markdown),
		markdown
			.replace('Before Multi API.', 'Before <Multi API>.')
			.replace('After Multi API.', 'After <Multi API>.'),
	)
})

test('leaves an indented code block as written', () => {
	assert.equal(
		highlight('    Multi API\n\nThen Multi API.\n'),
		'    Multi API\n\nThen <Multi API>.\n',
	)
})

test('never styles a title inside a longer word', () => {
	assert.equal(
		highlight('Multi APIs and XMulti API stay plain.'),
		'Multi APIs and XMulti API stay plain.',
	)
})

test('builds no pattern when no thread has a title', () => {
	assert.equal(titlePattern(['', '  ']), undefined)
})
