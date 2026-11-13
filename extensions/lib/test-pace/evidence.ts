import { PACE_REQUEST_ENTRY, readPaceRequest } from './request.ts'

import type { ConsentExchange } from './permission.ts'
import type { PaceRequest } from './request.ts'

const ASK_TOOL = 'ask_user_question'

/** A human's words and the agent text they answer; `at` is an ISO timestamp. */
export type Evidence = ConsentExchange & {
	id: string
	at: string
	mayGrant?: boolean
}
export type Relay = { sender: string; at: string; text: string }
/** Human words in one session, and the relays other terminals typed into it. */
export type SessionRecords = { evidence: Evidence[]; relays: Relay[] }

function field(record: unknown, key: string): unknown {
	return Reflect.get(Object(record), key)
}

function text(candidate: unknown): string {
	return typeof candidate === 'string' ? candidate : ''
}

export function messageText(message: unknown): string {
	const content = field(message, 'content')
	if (!Array.isArray(content)) return ''
	return content
		.filter(part => field(part, 'type') === 'text')
		.map(part => text(field(part, 'text')))
		.join('\n')
		.trim()
}

function questionText(question: unknown): string {
	const options = field(question, 'options')
	const labels = Array.isArray(options)
		? options.map(option => text(field(option, 'label'))).join('; ')
		: ''
	return `${text(field(question, 'id'))}: ${text(field(question, 'prompt'))}\nOptions: ${labels}`
}

function questionnaireEvidence(message: unknown, at: string): Evidence[] {
	const details = field(message, 'details')
	const questions = field(details, 'questions')
	const answers = field(details, 'answers')
	const submitted =
		field(message, 'toolName') === ASK_TOOL &&
		field(details, 'cancelled') !== true &&
		!field(details, 'chat') &&
		Array.isArray(questions) &&
		Array.isArray(answers)
	if (!submitted) return []
	return answers.flatMap(answer => {
		const id = text(field(answer, 'id'))
		const question = questions.find(asked => field(asked, 'id') === id)
		const reply = text(field(answer, 'label'))
		if (!question || !reply) return []
		return [
			{
				id: `${text(field(message, 'toolCallId'))}:${id}`,
				at,
				question: questionText(question),
				reply,
			},
		]
	})
}

/** A typed prompt answers the agent text before it; a relay carries no human words. */
export function requestRecords(
	request: PaceRequest,
	at: string,
	question: string,
): SessionRecords {
	const { id, text: reply, origin } = request
	if (origin.kind === 'human')
		return { evidence: [{ id, at, question, reply }], relays: [] }
	const sender = origin.kind === 'relay' ? origin.sender : undefined
	return {
		evidence: [],
		relays: sender ? [{ sender, at, text: reply }] : [],
	}
}

export function sessionRecords(entries: readonly unknown[]): SessionRecords {
	const records: SessionRecords = { evidence: [], relays: [] }
	let question = ''
	for (const entry of entries) {
		const at = text(field(entry, 'timestamp'))
		const message = field(entry, 'message')
		const role = field(message, 'role')
		if (role === 'assistant') question = messageText(message) || question
		if (role === 'toolResult')
			records.evidence.push(...questionnaireEvidence(message, at))
		const request =
			field(entry, 'customType') === PACE_REQUEST_ENTRY
				? readPaceRequest(field(entry, 'data'))
				: undefined
		if (!request) continue
		const found = requestRecords(request, at, question)
		records.evidence.push(...found.evidence)
		records.relays.push(...found.relays)
	}
	return records
}

export function parseEntries(content: string): object[] {
	return content.split('\n').flatMap(line => {
		try {
			return line.trim() ? [Object(JSON.parse(line))] : []
		} catch {
			return []
		}
	})
}

/** The current branch of a Pi session file: from its last entry up through parent ids. */
export function sessionBranch(entries: readonly object[]): object[] {
	const byId = new Map(entries.map(entry => [field(entry, 'id'), entry]))
	const branch: object[] = []
	let current = entries.findLast(
		entry => typeof field(entry, 'id') === 'string',
	)
	while (current && !branch.includes(current)) {
		branch.push(current)
		current = byId.get(field(current, 'parentId'))
	}
	return branch.toReversed()
}
