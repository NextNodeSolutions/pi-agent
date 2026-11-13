import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Type } from 'typebox'

import { errorText } from '#lib/error-text.ts'

import { nullable, parseJson } from './schema.ts'

import type { Static, TSchema } from 'typebox'

const execute = promisify(execFile)
const TIMEOUT_MS = 10_000

export type WindowSource = 'ask' | 'skip'

const StatusSchema = Type.Object({
	tab: nullable(Type.String()),
	agent: nullable(Type.String()),
})

const SpacesSchema = Type.Object({
	spaces: Type.Array(
		Type.Object({
			tabs: Type.Array(
				Type.Object({
					id: Type.String(),
					terminals: Type.Array(
						Type.Object({ terminal: Type.String() }),
					),
				}),
			),
		}),
	),
})

function refusal(detail: string, cause?: unknown): Error {
	return new Error(
		`Cannot tell which terminals the person is on: ${detail}`,
		{ cause },
	)
}

async function ask<Schema extends TSchema>(
	command: string,
	schema: Schema,
): Promise<Static<Schema>> {
	try {
		const { stdout } = await execute('herdr-app', [command], {
			timeout: TIMEOUT_MS,
		})
		return parseJson(schema, stdout)
	} catch (error) {
		throw refusal(
			`herdr-app ${command} failed (${errorText(error)}). Pass --no-window only for a core no Herdr window shows.`,
			error,
		)
	}
}

// The two answers can disagree when a tab opens or closes between them, and a tab that vanished from the listing must not read as no pane at all.
async function onScreen(): Promise<string[]> {
	const [status, listing] = await Promise.all([
		ask('status', StatusSchema),
		ask('ls', SpacesSchema),
	])
	const shownTab = listing.spaces
		.flatMap(space => space.tabs)
		.find(tab => tab.id === status.tab)
	if (status.tab !== null && !shownTab)
		throw refusal(
			`herdr-app status names tab ${status.tab}, which herdr-app ls does not list.`,
		)
	const inTab = shownTab?.terminals.map(pane => pane.terminal) ?? []
	return status.agent === null ? inTab : [status.agent, ...inTab]
}

export async function attachedTerminals(
	named: readonly string[],
	source: WindowSource,
): Promise<Set<string>> {
	const shown = source === 'ask' ? await onScreen() : []
	return new Set([...named, ...shown])
}
