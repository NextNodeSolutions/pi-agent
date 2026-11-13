import { readLabel } from '#lib/ui/herdr-labels.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const COMMAND_END = /[;&|\n]/u
const READ = /^hc\s+read\b(?<rest>.*)$/u
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

// Only a command that begins with the read can be taken as done: an earlier command may skip it, and a later one does not undo it.
function screenRead(command: string): string | null {
	const [first = ''] = command.trim().split(COMMAND_END)
	const found = READ.exec(first)
	if (!found) return null
	return terminalIn(found.groups?.['rest'] ?? '')
}

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
		const terminal = screenRead(command)
		if (terminal !== null) void stamp(terminal, startMs)
		return undefined
	})
}
