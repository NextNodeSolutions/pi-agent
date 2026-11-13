/** Style every known thread title in Markdown prose, leaving code spans and code blocks as written. */
import { Marked } from '@earendil-works/pi-tui'

const markdownLexer = new Marked()
const FENCE_LINE = /^[\s>]*(`{3,}|~{3,})/u
const BACKTICK_RUN = /`+/gu
const LINE_BREAK = /(?<=\n)/u
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu
const WORD_CHARACTER = /[\p{L}\p{N}_]/u.source

type StyleTitle = (title: string) => string

/** One alternation, longest title first, so a title never matches inside a longer one. */
export function titlePattern(titles: readonly string[]): RegExp | undefined {
	const alternatives = [...new Set(titles)]
		.filter(title => title.trim())
		.toSorted((left, right) => right.length - left.length)
		.map(title => title.replace(REGEX_SPECIAL, '\\$&'))
	if (!alternatives.length) return undefined
	return new RegExp(
		`(?<!${WORD_CHARACTER})(?:${alternatives.join('|')})(?!${WORD_CHARACTER})`,
		'gu',
	)
}

function codeSpanEnd(text: string, start: number, length: number): number {
	for (const run of text.slice(start + length).matchAll(BACKTICK_RUN)) {
		if (run[0].length === length) return start + length + run.index + length
	}
	return -1
}

/** CommonMark code spans: a backtick run closes only on the next run of the same length. */
function styleOutsideCodeSpans(
	text: string,
	pattern: RegExp,
	style: StyleTitle,
): string {
	let styled = ''
	let cursor = 0
	for (const run of text.matchAll(BACKTICK_RUN)) {
		if (run.index < cursor) continue
		const end = codeSpanEnd(text, run.index, run[0].length)
		if (end < 0) continue
		styled +=
			text.slice(cursor, run.index).replace(pattern, style) +
			text.slice(run.index, end)
		cursor = end
	}
	return styled + text.slice(cursor).replace(pattern, style)
}

/** Fences nested in lists and quotes keep their container prefix, so lines are matched past `>` and indentation. */
function styleProse(raw: string, pattern: RegExp, style: StyleTitle): string {
	let styled = ''
	let prose = ''
	let fence = ''
	for (const line of raw.split(LINE_BREAK)) {
		const marker = FENCE_LINE.exec(line)?.[1] ?? ''
		if (fence) {
			styled += line
			fence = marker.startsWith(fence) ? '' : fence
			continue
		}
		if (marker) {
			styled += styleOutsideCodeSpans(prose, pattern, style) + line
			prose = ''
			fence = marker
			continue
		}
		prose += line
	}
	return styled + styleOutsideCodeSpans(prose, pattern, style)
}

export function highlightTitles(
	markdown: string,
	pattern: RegExp,
	style: StyleTitle,
): string {
	if (markdown.search(pattern) < 0) return markdown
	return markdownLexer
		.lexer(markdown)
		.map(token =>
			token.type === 'code'
				? token.raw
				: styleProse(token.raw, pattern, style),
		)
		.join('')
}
