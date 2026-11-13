/** Style every known thread title in Markdown prose, leaving code, links and URLs as written. */
const FENCE = /^[\s>]*(`{3,}|~{3,})/u
const FENCE_CLOSE = new RegExp(`${FENCE.source}[ \\t]*$`, 'u')
const BLOCKQUOTE_PREFIX = /^(?: {0,3}> ?)+/u
const LIST_MARKER = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+/u
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]/u
const INDENT_END = /[^ \t]|$/u
const DEFINITION = /^[ \t]{0,3}\[[^\]\n]+\]:/u
const LINK_OR_URL =
	/!?\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])?|\b(?:https?|ftp):\/\/\S+|<[^\s<>]+>/gu
const BACKTICK_RUN = /`+/gu
const PARAGRAPH_BREAK = /(\r?\n[ \t]*\r?\n)/u
const LINE_BREAK = /(?<=\r?\n)/u
const LINE_TAIL = /\r?\n$/u
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu
const WORD_CHARACTER = /[\p{L}\p{N}_]/u.source
const CODE_INDENT = 4
const ESCAPE_PAIR = 2
const TAB_WIDTH = 4

type StyleTitle = (title: string) => string
type Fence = { readonly character: string; readonly length: number }
type ScanState = {
	readonly fence: Fence | undefined
	readonly isParagraphOpen: boolean
	readonly containerIndent: number
}
type LineScan = ScanState & { readonly isProtected: boolean }
type Range = readonly [start: number, end: number]

/** One alternation, longest title first, so a title never matches inside a longer one. */
export function titlePattern(titles: readonly string[]): RegExp | undefined {
	const alternatives = titles
		.filter(title => title.trim())
		.toSorted((left, right) => right.length - left.length)
		.map(title => title.replace(REGEX_SPECIAL, '\\$&'))
	if (!alternatives.length) return undefined
	return new RegExp(
		`(?<!${WORD_CHARACTER})(?:${alternatives.join('|')})(?!${WORD_CHARACTER})`,
		'gu',
	)
}

function isEscaped(text: string, at: number): boolean {
	let backslashes = 0
	while (text[at - backslashes - 1] === '\\') backslashes += 1
	return backslashes % ESCAPE_PAIR === 1
}

/** CommonMark code spans: a backtick run closes on the next run of the same length, and a backslash never escapes it. */
function codeSpanEnd(text: string, start: number, length: number): number {
	for (const run of text.slice(start + length).matchAll(BACKTICK_RUN)) {
		if (run[0].length === length) return start + length + run.index + length
	}
	return -1
}

function codeSpanRanges(text: string): Range[] {
	const ranges: Range[] = []
	let cursor = 0
	for (const run of text.matchAll(BACKTICK_RUN)) {
		const start = run.index
		if (start < cursor || isEscaped(text, start)) continue
		const end = codeSpanEnd(text, start, run[0].length)
		if (end < 0) continue
		ranges.push([start, end])
		cursor = end
	}
	return ranges
}

/** Links, autolinks and bare URLs render as one unit: styling inside them breaks the target. */
function linkRanges(text: string): Range[] {
	return [...text.matchAll(LINK_OR_URL)].map(link => [
		link.index,
		link.index + link[0].length,
	])
}

/** Code spans and links are protected together, so a code span inside a link label cannot expose the link. */
function styleSpansInParagraph(
	text: string,
	pattern: RegExp,
	style: StyleTitle,
): string {
	const ranges = [...codeSpanRanges(text), ...linkRanges(text)].toSorted(
		(left, right) => left[0] - right[0],
	)
	let styled = ''
	let cursor = 0
	for (const [start, end] of ranges) {
		if (end <= cursor) continue
		const from = Math.max(start, cursor)
		styled +=
			text.slice(cursor, from).replace(pattern, style) +
			text.slice(from, end)
		cursor = end
	}
	return styled + text.slice(cursor).replace(pattern, style)
}

function styleSpans(text: string, pattern: RegExp, style: StyleTitle): string {
	const [first = '', ...rest] = text.split(PARAGRAPH_BREAK)
	let styled = styleSpansInParagraph(first, pattern, style)
	let isSeparator = true
	for (const part of rest) {
		styled += isSeparator
			? part
			: styleSpansInParagraph(part, pattern, style)
		isSeparator = !isSeparator
	}
	return styled
}

function leadingColumns(line: string): number {
	return line
		.slice(0, line.search(INDENT_END))
		.replaceAll('\t', ' '.repeat(TAB_WIDTH)).length
}

function isClosing(run: string, fence: Fence): boolean {
	return run.charAt(0) === fence.character && run.length >= fence.length
}

function closedFence(body: string, fence: Fence): Fence | undefined {
	const closing = FENCE_CLOSE.exec(body)?.[1]
	if (closing && isClosing(closing, fence)) return undefined
	return fence
}

function openedFence(body: string): Fence | undefined {
	const opening = FENCE.exec(body)?.[1]
	if (!opening) return undefined
	return { character: opening.charAt(0), length: opening.length }
}

function listIndent(body: string): number | undefined {
	const marker = LIST_MARKER.exec(body)
	if (!marker) return undefined
	return leadingColumns(marker[0])
}

/** A heading ends the paragraph before it, so an indented line after one starts a code block. */
function opensParagraph(body: string): boolean {
	return !HEADING.test(body) && body.trim() !== ''
}

function scanLine(line: string, state: ScanState): LineScan {
	const body = line.replace(BLOCKQUOTE_PREFIX, '').replace(LINE_TAIL, '')
	const containerIndent = listIndent(body) ?? state.containerIndent
	const protect = (fence: Fence | undefined): LineScan => ({
		isProtected: true,
		fence,
		isParagraphOpen: false,
		containerIndent,
	})
	if (state.fence) return protect(closedFence(body, state.fence))
	if (DEFINITION.test(body)) return protect(undefined)
	if (!state.isParagraphOpen) {
		const fence = openedFence(body.replace(LIST_MARKER, ''))
		if (fence || leadingColumns(body) >= containerIndent + CODE_INDENT)
			return protect(fence)
	}
	return {
		isProtected: false,
		fence: undefined,
		isParagraphOpen: opensParagraph(body),
		containerIndent,
	}
}

export function highlightTitles(
	markdown: string,
	pattern: RegExp,
	style: StyleTitle,
): string {
	if (markdown.search(pattern) < 0) return markdown
	let styled = ''
	let prose = ''
	let state: ScanState = {
		fence: undefined,
		isParagraphOpen: false,
		containerIndent: 0,
	}

	const flushProse = (): void => {
		styled += styleSpans(prose, pattern, style)
		prose = ''
	}

	for (const line of markdown.split(LINE_BREAK)) {
		const scan = scanLine(line, state)
		if (scan.isProtected) {
			flushProse()
			styled += line
		} else {
			prose += line
		}
		state = scan
	}

	flushProse()
	return styled
}
