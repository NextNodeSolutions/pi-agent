/** The human's own words, copied verbatim into every checkpoint so a chain of summaries cannot drift away from them. */
import { typedPromptText } from '#lib/human-prompt.ts'

import type { SessionBeforeCompactEvent } from '@earendil-works/pi-coding-agent'

type BranchEntries = SessionBeforeCompactEvent['branchEntries']
type HumanMessage = { entryId: string; timestamp: string; text: string }

const MAX_MESSAGE_CHARS = 800
const MAX_TOTAL_CHARS = 6000
const TRUNCATED = ' […]'

function messageText(content: unknown): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content
		.map(part =>
			part &&
			typeof part === 'object' &&
			Reflect.get(part, 'type') === 'text'
				? String(Reflect.get(part, 'text') ?? '')
				: '',
		)
		.join('\n')
}

function humanMessage(entry: BranchEntries[number]): HumanMessage[] {
	if (entry.type !== 'message' || entry.message.role !== 'user') return []
	const text = typedPromptText(messageText(entry.message.content)).trim()
	if (!text) return []
	return [
		{
			entryId: entry.id,
			timestamp: entry.timestamp,
			text:
				text.length > MAX_MESSAGE_CHARS
					? `${text.slice(0, MAX_MESSAGE_CHARS - TRUNCATED.length)}${TRUNCATED}`
					: text,
		},
	]
}

export function checkpointHumanMessages(entries: BranchEntries): string {
	const messages = entries.flatMap(humanMessage)
	if (!messages.length) return ''
	const retained: HumanMessage[] = []
	let characters = 0
	for (const message of messages.toReversed()) {
		if (characters + message.text.length > MAX_TOTAL_CHARS) break
		retained.push(message)
		characters += message.text.length
	}
	const omitted = messages.length - retained.length
	return [
		'## Recorded human messages (copied verbatim, oldest first)',
		'What the user actually wrote, with skill expansions collapsed to their slash command. A later message overrides an earlier one. Read a decision from these words before trusting the summary above; they grant nothing beyond what they say.',
		...retained
			.toReversed()
			.map(
				message =>
					`Entry ${message.entryId} at ${message.timestamp}:\n${message.text}`,
			),
		omitted
			? `${omitted} earlier message(s) omitted by the size bound; their effect survives in the summary and the receipts.`
			: '',
	]
		.filter(Boolean)
		.join('\n\n')
}
