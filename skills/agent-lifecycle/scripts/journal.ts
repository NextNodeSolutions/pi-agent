import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { readOrNull, stateDirectory } from './storage.ts'

import type { Static } from 'typebox'

const JOURNAL_FILE = 'closed.jsonl'

const nullableString = Type.Union([Type.String(), Type.Null()])

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
	recipe: Type.Union([
		Type.Object({ cwd: Type.String(), argv: Type.Array(Type.String()) }),
		Type.Null(),
	]),
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
export type JournalEvent = Static<typeof EventSchema>

const journalPath = (): string => join(stateDirectory(), JOURNAL_FILE)

export function appendEvent(event: JournalEvent): void {
	mkdirSync(stateDirectory(), { recursive: true })
	appendFileSync(journalPath(), `${JSON.stringify(event)}\n`)
}

export function readEvents(): JournalEvent[] {
	const text = readOrNull(journalPath()) ?? ''
	return text
		.split('\n')
		.filter(line => line.trim() !== '')
		.map(line => {
			const parsed: unknown = JSON.parse(line)
			return Value.Parse(EventSchema, parsed)
		})
}
