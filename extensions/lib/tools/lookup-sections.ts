/**
 * The one format of a `lookup` result: one `## [n] <operation>` section per
 * nested operation. The lookup tool renders it; the context checkpoint parses
 * it back to retain the skill files read through a lookup. Pure.
 */

/** The fields of a lookup operation that name its target; the tool schema owns validation. */
export interface LookupTarget {
	tool: string
	path?: string | undefined
	pattern?: string | undefined
	offset?: number | undefined
	limit?: number | undefined
}

export interface LookupSection {
	index: number
	description: string
	isError: boolean
	body: string
}

const ERROR_SUFFIX = ' - error'
const HEADER = new RegExp(
	`^## \\[(?<index>\\d+)\\] (?<description>.*?)(?<error>${ERROR_SUFFIX})?$`,
	'u',
)

function readRange(op: LookupTarget): string {
	if (!op.offset && !op.limit) return ''
	const first = op.offset ?? 1
	if (!op.limit) return ` ${first}-`
	return ` ${first}-${first + op.limit - 1}`
}

export function describeOperation(op: LookupTarget): string {
	const target = op.path ?? '.'
	if (op.tool === 'read') return `read ${target}${readRange(op)}`
	if (op.tool === 'ls') return `ls ${target}`
	return `${op.tool} ${JSON.stringify(op.pattern ?? '')} in ${target}`
}

export function sectionHeader(
	index: number,
	op: LookupTarget,
	isError: boolean,
): string {
	return `## [${index}] ${describeOperation(op)}${isError ? ERROR_SUFFIX : ''}`
}

/** Sections in order; a body line that happens to look like a header splits too, so callers verify bodies against their source. */
export function lookupSections(text: string): LookupSection[] {
	const sections: LookupSection[] = []
	for (const line of text.split('\n')) {
		const header = HEADER.exec(line)?.groups
		if (header?.index) {
			sections.push({
				index: Number(header.index),
				description: header.description ?? '',
				isError: Boolean(header.error),
				body: '',
			})
			continue
		}
		const current = sections.at(-1)
		if (current)
			current.body = current.body ? `${current.body}\n${line}` : line
	}
	return sections
}
