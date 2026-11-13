import {
	messageText,
	requestRecords,
	sessionBranch,
	sessionRecords,
} from '../extensions/lib/test-pace/evidence.ts'
import {
	PACE_REQUEST_ENTRY,
	readPaceRequest,
	safePaceText,
	typedOrigin,
} from '../extensions/lib/test-pace/request.ts'

import type {
	Evidence,
	SessionRecords,
} from '../extensions/lib/test-pace/evidence.ts'

const HARNESS_TEXT =
	/^\s*<(?:command-(?:name|message|args)|local-command-|task-notification|system-reminder)/

function field(value: unknown, key: string): unknown {
	return Reflect.get(Object(value), key)
}

function typedText(entry: object): string {
	if (field(entry, 'isMeta') || field(entry, 'isCompactSummary')) return ''
	if (field(entry, 'type') !== 'user') return ''
	const content = field(field(entry, 'message'), 'content')
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	if (content.some(part => field(part, 'type') === 'tool_result')) return ''
	return content
		.map(part => field(part, 'text'))
		.filter(text => typeof text === 'string')
		.join('\n')
}

function claudeTyped(entry: object): string {
	const text = typedText(entry)
	return HARNESS_TEXT.test(text) ? '' : text
}

/** Claude Code stores an AskUserQuestion result as `toolUseResult.answers`: question text to chosen label. */
function askAnswers(entry: object, id: string, at: string): Evidence[] {
	const result = field(entry, 'toolUseResult')
	const answers = field(result, 'answers')
	const questions = field(result, 'questions')
	if (!answers || typeof answers !== 'object') return []
	return Object.entries(answers).flatMap(([prompt, reply], index) => {
		if (typeof reply !== 'string' || !reply) return []
		const asked = Array.isArray(questions)
			? questions.find(question => field(question, 'question') === prompt)
			: undefined
		const options = field(asked, 'options')
		const labels = Array.isArray(options)
			? options.map(option => String(field(option, 'label'))).join('; ')
			: ''
		const question = `${prompt}\nOptions: ${labels}`
		return [{ id: `${id}:${index}`, at, question, reply }]
	})
}

function claudeRecords(entries: readonly object[]): SessionRecords {
	const records: SessionRecords = { evidence: [], relays: [] }
	let question = ''
	for (const entry of entries.filter(item => !field(item, 'isSidechain'))) {
		const at = String(field(entry, 'timestamp') ?? '')
		const id = String(field(entry, 'uuid') ?? '')
		if (field(entry, 'type') === 'assistant')
			question = messageText(field(entry, 'message')) || question
		records.evidence.push(...askAnswers(entry, id, at))
		const typed = claudeTyped(entry)
		if (!typed) continue
		const found = requestRecords(
			{ id, text: safePaceText(typed), origin: typedOrigin(typed) },
			at,
			question,
		)
		records.evidence.push(...found.evidence)
		records.relays.push(...found.relays)
	}
	return records
}

export function transcriptRecords(entries: readonly object[]): SessionRecords {
	return entries.some(entry => field(entry, 'type') === 'session')
		? sessionRecords(sessionBranch(entries))
		: claudeRecords(entries)
}

function requestText(entry: object): string {
	if (
		field(entry, 'type') === 'custom' &&
		field(entry, 'customType') === PACE_REQUEST_ENTRY
	)
		return readPaceRequest(field(entry, 'data'))?.text ?? ''
	return claudeTyped(entry)
}

export function lastHumanRequest(entries: readonly object[]): string {
	return entries.toReversed().map(requestText).find(Boolean) ?? ''
}
