import { readLabel } from '#lib/ui/herdr-labels.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const READ = /(?:^|[\s;&|(])hc\s+read\b(?<rest>[^;&|\n)]*)/gu
const WAIT = /(?:^|[\s;&|(])hc\s+(?:wait\b|send\s[^;&|\n]*--wait\b)/u
const VALUE_FLAGS = new Set(['--lines'])
const TERMINAL = /^[\w./-]+$/u
const QUOTES = /^["']|["']$/gu

type ScreenRead = { terminal: string; followsWait: boolean }

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

function screenReads(command: string): ScreenRead[] {
	return [...command.matchAll(READ)].flatMap(found => {
		const terminal = terminalIn(found.groups?.['rest'] ?? '')
		if (!terminal) return []
		const followsWait = WAIT.test(command.slice(0, found.index))
		return [{ terminal, followsWait }]
	})
}

// A read is stamped with the earliest moment it can have happened, so a terminal that finished while its command ran never counts as read after it finished: the command's start, or its end when the command waited before reading.
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
		const endMs = Date.now()
		for (const read of screenReads(command))
			void stamp(read.terminal, read.followsWait ? endMs : startMs)
		return undefined
	})
}
