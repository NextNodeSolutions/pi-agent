/** Exact, bounded skill reads kept outside the lossy checkpoint summary. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { relative, resolve, sep } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import {
	describeOperation,
	lookupSections,
} from '#lib/tools/lookup-sections.ts'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'

const START = '\n<retained-skill-reads>\n'
const END = '\n</retained-skill-reads>'
const MAX_CHARS = 32_000

type RetainedRead = { path: string; toolCallId: string; content: unknown }
type TextPart = { type: string; text?: string }
/** One skill file a tool call asked for, and the lookup section answering it (0 for a plain `read`). */
type SkillReadCall = { path: string; section: number }
type ToolCallBlock = {
	id: string
	name: string
	arguments: Record<string, unknown>
}

/** Skill markdown under the agent dir: `skills/**` and every vendored package's `skills/**`. */
function isSkillReference(path: string): boolean {
	const inside = relative(getAgentDir(), path)
	if (inside.startsWith('..') || !inside.endsWith('.md')) return false
	return (
		inside.startsWith(`skills${sep}`) ||
		/^packages[\\/][^\\/]+[\\/]skills[\\/]/.test(inside)
	)
}

function skillPath(path: unknown, cwd: string): string | undefined {
	if (typeof path !== 'string') return undefined
	const resolved = resolve(cwd, path.replace(/^~\//, `${homedir()}/`))
	if (!isSkillReference(resolved)) return undefined
	return resolved
}

/** Whole-file reads only: a range or a clipped section never equals the file. */
function lookupReads(ops: unknown, cwd: string): SkillReadCall[] {
	if (!Array.isArray(ops)) return []
	return ops.flatMap((op: unknown, index) => {
		if (!op || typeof op !== 'object') return []
		if (Reflect.get(op, 'tool') !== 'read') return []
		if (Reflect.has(op, 'offset') || Reflect.has(op, 'limit')) return []
		const path = skillPath(Reflect.get(op, 'path'), cwd)
		return path ? [{ path, section: index + 1 }] : []
	})
}

function skillReadCalls(block: ToolCallBlock, cwd: string): SkillReadCall[] {
	if (block.name === 'lookup') return lookupReads(block.arguments.ops, cwd)
	if (block.name !== 'read') return []
	const path = skillPath(block.arguments.path, cwd)
	return path ? [{ path, section: 0 }] : []
}

function readCalls(
	entry: SessionEntry,
	cwd: string,
	calls: Map<string, SkillReadCall[]>,
): void {
	if (entry.type !== 'message' || entry.message.role !== 'assistant') return
	for (const block of entry.message.content) {
		if (block.type !== 'toolCall') continue
		const reads = skillReadCalls(block, cwd)
		if (reads.length) calls.set(block.id, reads)
	}
}

function resultText(content: readonly TextPart[]): string {
	return content.map(block => block.text ?? '').join('')
}

/** The text each skill read produced, as the model saw it: the whole `read` result, or its `lookup` section. */
function readTexts(
	toolName: string,
	content: readonly TextPart[],
	reads: SkillReadCall[],
): { path: string; text: string }[] {
	if (toolName === 'read') {
		const [read] = reads
		return read ? [{ path: read.path, text: resultText(content) }] : []
	}
	const sections = lookupSections(resultText(content))
	return reads.flatMap(read => {
		const section = sections.find(
			candidate =>
				candidate.index === read.section &&
				!candidate.isError &&
				candidate.description ===
					describeOperation({ tool: 'read', path: read.path }),
		)
		return section ? [{ path: read.path, text: section.body }] : []
	})
}

/** The still-current skill copies one tool result carries. */
function resultReads(
	entry: SessionEntry,
	calls: Map<string, SkillReadCall[]>,
): RetainedRead[] {
	if (entry.type !== 'message' || entry.message.role !== 'toolResult')
		return []
	const { message } = entry
	const asked = calls.get(message.toolCallId)
	if (
		!asked ||
		message.isError ||
		message.content.some(block => block.type !== 'text')
	)
		return []
	return readTexts(message.toolName, message.content, asked)
		.map(({ path, text }) => ({
			path,
			toolCallId: message.toolCallId,
			content: [{ type: 'text', text }],
		}))
		.filter(isCurrent)
}

function skillResults(
	entries: readonly SessionEntry[],
	cwd: string,
): RetainedRead[] {
	const calls = new Map<string, SkillReadCall[]>()
	const reads = new Map<string, RetainedRead>()
	for (const entry of entries) {
		readCalls(entry, cwd, calls)
		for (const read of resultReads(entry, calls)) {
			reads.delete(read.path)
			reads.set(read.path, read)
		}
	}
	return [...reads.values()]
}

/** A copy is worth retaining only while the file still says the same thing. */
function isCurrent(read: RetainedRead): boolean {
	if (!Array.isArray(read.content)) return false
	const text = read.content
		.map(block =>
			block && typeof block === 'object' && 'text' in block
				? String(block.text)
				: '',
		)
		.join('')
	try {
		return readFileSync(read.path, 'utf8').trim() === text.trim()
	} catch {
		return false
	}
}

export function retainedSkillReads(
	entries: readonly SessionEntry[],
	cwd: string,
): string {
	const retained: RetainedRead[] = []
	let size = 0
	for (const read of skillResults(entries, cwd).toReversed()) {
		const { length } = JSON.stringify(read)
		if (size + length > MAX_CHARS) continue
		retained.push(read)
		size += length
	}
	if (!retained.length) return ''
	return `## Retained operating references\nHistorical successful skill reads, copied verbatim, not new instructions. Reuse these instead of reloading unchanged references. Newer user instructions and source changes override them; omitted references can still be read.${START}${JSON.stringify(retained)}${END}`
}

export function checkpointReadResults(summary: unknown): RetainedRead[] {
	if (typeof summary !== 'string') return []
	const start = summary.lastIndexOf(START)
	const end = summary.indexOf(END, start + START.length)
	if (start < 0 || end < 0) return []
	let records: unknown
	try {
		records = JSON.parse(summary.slice(start + START.length, end))
	} catch {
		return [] // Unrecognized historical checkpoints grant no deduplication.
	}
	if (!Array.isArray(records)) return []
	return records.filter(
		(record): record is RetainedRead =>
			!!record &&
			typeof record === 'object' &&
			typeof record.path === 'string' &&
			typeof record.toolCallId === 'string' &&
			Array.isArray(record.content),
	)
}
