import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static, TSchema } from 'typebox'

const execute = promisify(execFile)
const TIMEOUT_MS = 10_000

export type WindowSource = 'ask' | 'skip'

const StatusSchema = Type.Object({
	tab: Type.Union([Type.String(), Type.Null()]),
	agent: Type.Union([Type.String(), Type.Null()]),
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

async function ask<Schema extends TSchema>(
	command: string,
	schema: Schema,
): Promise<Static<Schema>> {
	try {
		const { stdout } = await execute('herdr-app', [command], {
			timeout: TIMEOUT_MS,
		})
		const parsed: unknown = JSON.parse(stdout)
		return Value.Parse(schema, parsed)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new Error(
			`Cannot tell which terminals the person is on: herdr-app ${command} failed (${detail}). Nothing was closed. Pass --no-window only for a core no Herdr window shows.`,
			{ cause: error },
		)
	}
}

async function onScreen(): Promise<string[]> {
	const [status, listing] = await Promise.all([
		ask('status', StatusSchema),
		ask('ls', SpacesSchema),
	])
	const shownTab = listing.spaces
		.flatMap(space => space.tabs)
		.find(tab => tab.id === status.tab)
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
