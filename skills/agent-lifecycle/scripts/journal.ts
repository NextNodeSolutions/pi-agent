import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Type } from 'typebox'

import { RecipeSchema } from './resume.ts'
import { nullable, parseJson } from './schema.ts'
import { readOrNull, stateDirectory } from './storage.ts'

import type { Static } from 'typebox'

const JOURNAL_FILE = 'closed.jsonl'

const nullableString = nullable(Type.String())

const ClosedSchema = Type.Object({
	event: Type.Literal('closed'),
	atMs: Type.Number(),
	address: Type.String(),
	name: nullableString,
	title: Type.String(),
	kind: Type.String(),
	app: nullableString,
	turn: Type.Number(),
	reason: Type.String(),
	parent: nullableString,
	owner: nullableString,
	labels: Type.Record(Type.String(), Type.String()),
	recipe: nullable(RecipeSchema),
	trace: nullableString,
})

const ReopenedSchema = Type.Object({
	event: Type.Literal('reopened'),
	atMs: Type.Number(),
	address: Type.String(),
	as: Type.String(),
})

const WorktreeRemovedSchema = Type.Object({
	event: Type.Literal('worktree-removed'),
	atMs: Type.Number(),
	folder: Type.String(),
	detail: Type.String(),
})

const EventSchema = Type.Union([
	ClosedSchema,
	ReopenedSchema,
	WorktreeRemovedSchema,
])

export type ClosedEvent = Static<typeof ClosedSchema>
type ReopenedEvent = Static<typeof ReopenedSchema>
export type JournalEvent = Static<typeof EventSchema>

export function reopenAfter(
	events: readonly JournalEvent[],
	closed: ClosedEvent,
): ReopenedEvent | null {
	return (
		events.findLast(
			(event): event is ReopenedEvent =>
				event.event === 'reopened' &&
				event.address === closed.address &&
				event.atMs >= closed.atMs,
		) ?? null
	)
}

const journalPath = (): string => join(stateDirectory(), JOURNAL_FILE)

export function appendEvent(event: JournalEvent): void {
	mkdirSync(stateDirectory(), { recursive: true })
	appendFileSync(journalPath(), `${JSON.stringify(event)}\n`)
}

function parsedEvent(line: string): JournalEvent | null {
	try {
		return parseJson(EventSchema, line)
	} catch {
		return null
	}
}

// A torn or hand-edited line costs only its own event: the rest of the journal still answers reopen and the closed index.
export function readEvents(): JournalEvent[] {
	const lines = (readOrNull(journalPath()) ?? '').split('\n')
	const read = lines.flatMap((line, index) =>
		line.trim() ? [{ number: index + 1, event: parsedEvent(line) }] : [],
	)
	const unreadable = read.filter(line => !line.event)
	if (unreadable.length)
		process.stderr.write(
			`agent-lifecycle: skipped unreadable line ${unreadable.map(line => line.number).join(', ')} of ${journalPath()}\n`,
		)
	return read.flatMap(line => (line.event ? [line.event] : []))
}
