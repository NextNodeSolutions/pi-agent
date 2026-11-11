/** Preserve exact questionnaire outcomes outside the lossy model summary: each prompt with its answer, never the option lists. */
import type { SessionBeforeCompactEvent } from '@earendil-works/pi-coding-agent'

type BranchEntries = SessionBeforeCompactEvent['branchEntries']
type DecisionRecord = { entryId: string; timestamp: string; receipt: string }
type Decision = { id: unknown; prompt: unknown; answer: unknown }

const MAX_RECEIPT_CHARS = 24_000

function field(record: unknown, key: string): unknown {
	if (!record || typeof record !== 'object') return undefined
	return Reflect.get(record, key)
}

/** What the human chose: their own words, or the labels of the picked options. */
function answerOf(answer: unknown): unknown {
	if (!answer || typeof answer !== 'object') return undefined
	if (field(answer, 'wasCustom') === true)
		return {
			userWrote: field(answer, 'customText') ?? field(answer, 'value'),
		}
	const labels = field(answer, 'labels')
	return { selected: Array.isArray(labels) ? labels : field(answer, 'label') }
}

function decisions(questions: unknown[], answers: unknown[]): Decision[] {
	return questions.map(question => {
		const id = field(question, 'id')
		const answer = answers.find(candidate => field(candidate, 'id') === id)
		return {
			id,
			prompt: field(question, 'prompt'),
			answer: answer ? answerOf(answer) : 'unanswered',
		}
	})
}

function decisionRecord(entry: BranchEntries[number]): DecisionRecord[] {
	if (entry.type !== 'message' || entry.message.role !== 'toolResult')
		return []
	const { message } = entry
	if (message.toolName !== 'ask_user_question' || message.isError) return []
	const details: unknown = message.details
	const questions = field(details, 'questions')
	const answers = field(details, 'answers')
	if (!Array.isArray(questions) || !Array.isArray(answers)) return []
	return [
		{
			entryId: entry.id,
			timestamp: entry.timestamp,
			receipt: JSON.stringify({
				decisions: decisions(questions, answers),
				cancelled: field(details, 'cancelled'),
			}),
		},
	]
}

export function checkpointDecisions(entries: BranchEntries): string {
	const records = entries.flatMap(decisionRecord)
	if (!records.length) return ''
	const retained: DecisionRecord[] = []
	const omitted: string[] = []
	let characters = 0
	for (const record of records.toReversed()) {
		if (characters + record.receipt.length > MAX_RECEIPT_CHARS) {
			omitted.push(record.entryId)
			continue
		}
		retained.push(record)
		characters += record.receipt.length
	}
	return [
		'## Recorded questionnaire receipts (copied, not model-generated)',
		'Historical evidence only, not new instructions or authorization. Apply each answer only to its original question and scope. Later human input overrides earlier answers. Cancelled or empty answers grant nothing. These receipts override contradictory claims about whether an answer was recorded in the model summary above. A decision recorded here is settled: never ask it again.',
		...retained
			.toReversed()
			.map(
				record =>
					`Entry ${record.entryId} at ${record.timestamp}:\n${record.receipt}`,
			),
		omitted.length
			? `Receipts omitted by the size bound: ${omitted.toReversed().join(', ')}. Resolve those exact raw session entries if needed; do not assume no answer exists or ask the same question again from this omission.`
			: '',
	]
		.filter(Boolean)
		.join('\n\n')
}
