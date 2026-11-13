import { readLabel } from '#lib/ui/herdr-labels.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const READ = /^hc\s+read\b(?<rest>[^;&|<>\n]*)(?:$|&&)/u
const VALUE_FLAGS = new Set(['--lines'])
const TERMINAL = /^[\w./-]+$/u
const QUOTES = /^["']|["']$/gu

function terminalIn(readArguments: string): string | null {
	const words = readArguments.trim().split(/\s+/u)
	const positional = words.find(
		(word, index) =>
			!word.startsWith('-') && !VALUE_FLAGS.has(words[index - 1] ?? ''),
	)
	const terminal = positional?.replace(QUOTES, '')
	if (!terminal || !TERMINAL.test(terminal)) return null
	return terminal
}

// Only a read whose own failure fails the command proves it ran: an earlier command may skip it, a redirect may stop it, and `||`, `;` or `|` hide its exit.
function screenRead(command: string): string | null {
	const found = READ.exec(command.trim())
	if (!found) return null
	return terminalIn(found.groups?.['rest'] ?? '')
}

const isRunningJob = (details: unknown): boolean =>
	typeof details === 'object' && details !== null && 'jobId' in details

// The receipt carries the command's start, so a terminal that finished while the command ran never counts as read after it finished.
export function registerReadReceipts(pi: ExtensionAPI, reader: string): void {
	const startedMs = new Map<string, number>()
	const stamp = async (terminal: string, atMs: number): Promise<void> => {
		try {
			await pi.exec('hc', [
				'label',
				terminal,
				`${readLabel(reader)}=${atMs}`,
			])
		} catch {
			return
		}
	}
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
		const terminal = screenRead(command)
		if (terminal !== null) void stamp(terminal, startMs)
		return undefined
	})
}
