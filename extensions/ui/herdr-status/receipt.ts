import { readLabel } from '#lib/ui/herdr-labels.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export type LabelOn = (
	terminal: string,
	key: string,
	shown: string,
) => Promise<void>

const LEADING_READ = /^hc\s+read\b(?<rest>[^;&|<>\n"'`()]*)(?:$|&&)/u
const TRAILING_READ =
	/(?:;|&&|(?<![|\\]\s*)\n)\s*hc\s+read\b(?<rest>[^;&|<>\n"'`()]*)$/u
const VALUE_FLAGS = new Set(['--lines'])
const TERMINAL = /^[\w./-]+$/u

type ScreenRead = { terminal: string; atMs: number }

function terminalIn(readArguments: string): string | null {
	const words = readArguments.trim().split(/\s+/u)
	const terminal = words.find(
		(word, index) =>
			!word.startsWith('-') && !VALUE_FLAGS.has(words[index - 1] ?? ''),
	)
	if (!terminal || !TERMINAL.test(terminal)) return null
	return terminal
}

function readAt(
	found: RegExpExecArray | null,
	atMs: number,
): ScreenRead | null {
	if (!found) return null
	const terminal = terminalIn(found.groups?.['rest'] ?? '')
	if (terminal === null) return null
	return { terminal, atMs }
}

// Only a read whose failure fails the whole command proves it ran. One that opens the command ran at its start, one that closes it ran just before its end: a terminal that finished during the commands before it counts as read after it finished.
function screenRead(
	command: string,
	startMs: number,
	endMs: number,
): ScreenRead | null {
	const trimmed = command.trim()
	return (
		readAt(LEADING_READ.exec(trimmed), startMs) ??
		readAt(TRAILING_READ.exec(trimmed), endMs)
	)
}

const isRunningJob = (details: unknown): boolean =>
	typeof details === 'object' && details !== null && 'jobId' in details

export function registerReadReceipts(
	pi: ExtensionAPI,
	reader: string,
	labelOn: LabelOn,
): void {
	const startedMs = new Map<string, number>()
	pi.on('tool_call', event => {
		if (event.toolName === 'bash')
			startedMs.set(event.toolCallId, Date.now())
		return undefined
	})
	pi.on('tool_result', (event, ctx) => {
		const startMs = startedMs.get(event.toolCallId)
		startedMs.delete(event.toolCallId)
		if (event.toolName !== 'bash' || !startMs) return undefined
		const { command } = event.input
		if (event.isError || !ctx.hasUI || typeof command !== 'string')
			return undefined
		if (isRunningJob(event.details)) return undefined
		const read = screenRead(command, startMs, Date.now())
		if (read !== null)
			void labelOn(read.terminal, readLabel(reader), String(read.atMs))
		return undefined
	})
}
