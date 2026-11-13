import { readFileSync } from 'node:fs'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import {
	GOAL_LABEL,
	readLabel,
	SESSION_LABEL,
	WAITING_LABEL,
} from '#lib/ui/herdr-labels.ts'

import type { Static } from 'typebox'

const PolicySchema = Type.Object({
	principalName: Type.String(),
	auxiliaryKinds: Type.Array(Type.String()),
	restingStates: Type.Array(Type.String()),
	labels: Type.Object({
		keep: Type.String(),
		owner: Type.String(),
		seen: Type.String(),
	}),
	leaseMinutes: Type.Object({
		helper: Type.Number({ minimum: 0 }),
		reusedHelper: Type.Number({ minimum: 0 }),
		thread: Type.Number({ minimum: 0 }),
	}),
	confirmSeconds: Type.Number({ minimum: 0 }),
	worktreeRetryMinutes: Type.Number({ minimum: 0 }),
	traceScreenLines: Type.Integer({ minimum: 0 }),
	classes: Type.Array(
		Type.Object({
			id: Type.String(),
			is: Type.String(),
			closes: Type.String(),
			trace: Type.String(),
			resume: Type.String(),
			practice: Type.String(),
			why: Type.String(),
		}),
	),
	rules: Type.Array(Type.String()),
})

export type Policy = Static<typeof PolicySchema>

export const MINUTE_MS = 60_000

const DEFAULT_POLICY_FILE = new URL('../policy.json', import.meta.url)
const COLUMNS = ['is', 'closes', 'trace', 'resume', 'practice', 'why'] as const
const HEADINGS = [
	'Class',
	'What it is',
	'Closes',
	'Trace',
	'Resume',
	'Practice',
	'Why',
]

export function loadPolicy(file: string | null): Policy {
	const text = readFileSync(file ?? DEFAULT_POLICY_FILE, 'utf8')
	const parsed: unknown = JSON.parse(text)
	return Value.Parse(PolicySchema, parsed)
}

function placeholders(policy: Policy): Record<string, string> {
	return {
		principalName: policy.principalName,
		auxiliaryKinds: policy.auxiliaryKinds.join(', '),
		keep: policy.labels.keep,
		waiting: WAITING_LABEL,
		unfinished: GOAL_LABEL,
		read: readLabel('<its address>'),
		confirm: String(policy.confirmSeconds),
		owner: policy.labels.owner,
		session: SESSION_LABEL,
		helper: String(policy.leaseMinutes.helper),
		reusedHelper: String(policy.leaseMinutes.reusedHelper),
		thread: String(policy.leaseMinutes.thread),
		worktreeRetry: String(policy.worktreeRetryMinutes),
	}
}

function filled(text: string, values: Record<string, string>): string {
	return text.replace(
		/\{(\w+)\}/g,
		(whole, key: string) => values[key] ?? whole,
	)
}

function row(cells: readonly string[]): string {
	return `| ${cells.join(' | ')} |`
}

export function renderPolicy(policy: Policy): string {
	const values = placeholders(policy)
	const rows = policy.classes.map(entry =>
		row([
			entry.id,
			...COLUMNS.map(column => filled(entry[column], values)),
		]),
	)
	const rules = policy.rules.map(rule => `- ${filled(rule, values)}`)
	return [
		row(HEADINGS),
		row(HEADINGS.map(() => '---')),
		...rows,
		'',
		...rules,
	].join('\n')
}
