/** Style every known thread title in Markdown prose, leaving code spans, code blocks and link destinations as written. */
const FENCE = /^[\s>]*(`{3,}|~{3,})/u
const FENCE_CLOSE = /^[\s>]*(`{3,}|~{3,})[ \t]*$/u
const BLOCKQUOTE_PREFIX = /^(?: {0,3}> ?)+/u
const INDENTED_CODE = /^(?: {4,}|\t)/u
const BACKTICK_RUN = /`+/gu
const LINK_DESTINATION = /\]\([^\n)]*\)/gu
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu
const WORD_CHARACTER = /[\p{L}\p{N}_]/u.source
const LINE_BREAK = /(?<=\n)/u
const LINE_TAIL = /\n$/u
const ESCAPE_PAIR = 2

type StyleTitle = (title: string) => string
type Fence = { readonly character: string; readonly length: number }
type LineKind = 'blank' | 'prose' | 'code'
type LineScan = {
	readonly isCode: boolean
	readonly fence: Fence | undefined
	readonly kind: LineKind
}

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

function isEscaped(text: string, at: number): boolean {
	let backslashes = 0
	while (text[at - backslashes - 1] === '\\') backslashes += 1
	return backslashes % ESCAPE_PAIR === 1
}

/** CommonMark code spans: a backtick run closes only on the next unescaped run of the same length. */
function codeSpanEnd(text: string, start: number, length: number): number {
	for (const run of text.slice(start + length).matchAll(BACKTICK_RUN)) {
		const index = start + length + run.index
		if (run[0].length === length && !isEscaped(text, index))
			return index + length
	}
	return -1
}

/** A link destination is not prose: styling inside it would break the URL. */
function styleWords(text: string, pattern: RegExp, style: StyleTitle): string {
	let styled = ''
	let cursor = 0
	for (const destination of text.matchAll(LINK_DESTINATION)) {
		const start = destination.index
		styled +=
			text.slice(cursor, start).replace(pattern, style) + destination[0]
		cursor = start + destination[0].length
	}
	return styled + text.slice(cursor).replace(pattern, style)
}

function styleSpans(text: string, pattern: RegExp, style: StyleTitle): string {
	let styled = ''
	let cursor = 0
	for (const run of text.matchAll(BACKTICK_RUN)) {
		const start = run.index
		if (start < cursor || isEscaped(text, start)) continue
		const end = codeSpanEnd(text, start, run[0].length)
		if (end < 0) continue
		styled +=
			styleWords(text.slice(cursor, start), pattern, style) +
			text.slice(start, end)
		cursor = end
	}
	return styled + styleWords(text.slice(cursor), pattern, style)
}

function isClosing(run: string, fence: Fence): boolean {
	return run[0] === fence.character && run.length >= fence.length
}

function closedFence(body: string, fence: Fence): Fence | undefined {
	const closing = FENCE_CLOSE.exec(body)?.[1]
	if (closing && isClosing(closing, fence)) return undefined
	return fence
}

/** Fences nest in lists and quotes and indented code follows a blank line, so each line is read past its `>` prefix. */
function scanLine(
	line: string,
	fence: Fence | undefined,
	previousKind: LineKind,
): LineScan {
	const body = line.replace(BLOCKQUOTE_PREFIX, '').replace(LINE_TAIL, '')
	if (fence)
		return { isCode: true, fence: closedFence(body, fence), kind: 'code' }
	const opening = FENCE.exec(body)?.[1]
	if (opening)
		return {
			isCode: true,
			fence: { character: opening.charAt(0), length: opening.length },
			kind: 'code',
		}
	if (INDENTED_CODE.test(body) && previousKind !== 'prose')
		return { isCode: true, fence, kind: 'code' }
	return { isCode: false, fence, kind: body.trim() ? 'prose' : 'blank' }
}

export function highlightTitles(
	markdown: string,
	pattern: RegExp,
	style: StyleTitle,
): string {
	if (markdown.search(pattern) < 0) return markdown
	let styled = ''
	let prose = ''
	let fence: Fence | undefined
	let previousKind: LineKind = 'blank'

	const flushProse = (): void => {
		styled += styleSpans(prose, pattern, style)
		prose = ''
	}

	for (const line of markdown.split(LINE_BREAK)) {
		const scan = scanLine(line, fence, previousKind)
		if (scan.isCode) {
			flushProse()
			styled += line
		} else {
			prose += line
		}
		fence = scan.fence
		previousKind = scan.kind
	}

	flushProse()
	return styled
}
