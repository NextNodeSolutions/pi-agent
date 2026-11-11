/**
 * Where injected skill blocks sit in a request. A skill loaded with the
 * session heads the conversation. One loaded by a later tool call follows the
 * tool results that ended that request, so every earlier message stays
 * byte-identical: the provider's prompt cache extends, and Magpie hands the
 * results to the run that waits for them instead of retelling the whole
 * conversation to a new one. A block whose anchor left the context
 * (checkpoint, tree move) returns to the head, where the rewrite is already
 * paid. Pure, no state.
 */
import type { ContextEvent } from '@earendil-works/pi-coding-agent'

type ContextMessage = ContextEvent['messages'][number]

const CONTEXT_TYPE = 'skill-surface'

export type InjectedSkill = {
	name: string
	block: string
	/** The tool result ending the request the skill first rode in; undefined heads the conversation. */
	anchorToolCallId: string | undefined
}

export function currentAnchor(
	messages: readonly ContextMessage[],
): string | undefined {
	const last = messages.at(-1)
	if (last?.role !== 'toolResult') return undefined
	return last.toolCallId
}

function skillsMessage(
	skills: readonly InjectedSkill[],
	timestamp: number,
): ContextMessage {
	const names = skills.map(skill => skill.name).join(', ')
	const blocks = skills.map(skill => skill.block).join('\n\n')
	return {
		role: 'custom',
		customType: CONTEXT_TYPE,
		content: `Skills loaded for this session (their full content follows; never read their SKILL.md again): ${names}.\n\n${blocks}`,
		display: false,
		timestamp,
	}
}

function presentToolCallIds(messages: readonly ContextMessage[]): Set<string> {
	return new Set(
		messages.flatMap(message =>
			message.role === 'toolResult' ? [message.toolCallId] : [],
		),
	)
}

export function placeSkills(
	messages: readonly ContextMessage[],
	injected: readonly InjectedSkill[],
	headTimestamp: number,
): ContextMessage[] {
	const present = presentToolCallIds(messages)
	const head: InjectedSkill[] = []
	const anchored = new Map<string, InjectedSkill[]>()
	for (const skill of injected) {
		const anchor = skill.anchorToolCallId
		if (!anchor || !present.has(anchor)) {
			head.push(skill)
			continue
		}
		anchored.set(anchor, [...(anchored.get(anchor) ?? []), skill])
	}
	const placed = messages.flatMap(message => {
		if (message.role !== 'toolResult') return [message]
		const following = anchored.get(message.toolCallId)
		if (!following) return [message]
		return [message, skillsMessage(following, message.timestamp)]
	})
	if (!head.length) return placed
	const at = placed[0]?.role === 'user' ? 1 : 0
	return [
		...placed.slice(0, at),
		skillsMessage(head, headTimestamp),
		...placed.slice(at),
	]
}
