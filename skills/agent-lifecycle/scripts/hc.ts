import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static, TSchema } from 'typebox'
import type { Terminal } from './terminal.ts'

const execute = promisify(execFile)
const TIMEOUT_MS = 20_000
const MAX_OUTPUT_BYTES = 16_000_000
const NOT_FOUND_EXIT_CODE = 3
const FINISHED_EXIT_CODE = 11
const GONE_EXIT_CODES = [NOT_FOUND_EXIT_CODE, FINISHED_EXIT_CODE]
const LIVE = 'live'

const nullable = <Schema extends TSchema>(
	schema: Schema,
): ReturnType<typeof Type.Union<[Schema, ReturnType<typeof Type.Null>]>> =>
	Type.Union([schema, Type.Null()])

const ListingSchema = Type.Object({
	terminals: Type.Array(
		Type.Object({ address: Type.String(), state: Type.String() }),
	),
})

const RecordSchema = Type.Object({
	address: Type.String(),
	name: nullable(Type.String()),
	parent: nullable(Type.String()),
	state: Type.String(),
	status: nullable(
		Type.Object({
			state: Type.String(),
			app: Type.Optional(nullable(Type.String())),
		}),
	),
	status_ms: nullable(Type.Number()),
	created_ms: Type.Number(),
	turn: Type.Number(),
	cwd: Type.String(),
	die_with_parent: Type.Boolean(),
	labels: nullable(Type.Record(Type.String(), Type.String())),
	foreground: Type.Optional(
		nullable(
			Type.Object({
				pid: nullable(Type.Number()),
				cwd: nullable(Type.String()),
			}),
		),
	),
})

const StartedSchema = Type.Object({ address: Type.String() })

// hc counts a parent looking at its child as that child's news being seen, so the engine calls as nobody unless it names a caller.
function environmentAs(caller: string | null): NodeJS.ProcessEnv {
	const {
		HC_TERMINAL_ID: _terminal,
		HC_SCOPE: _scope,
		...anonymous
	} = process.env
	if (caller === null) return anonymous
	return { ...anonymous, HC_TERMINAL_ID: caller }
}

async function core(
	args: string[],
	caller: string | null = null,
): Promise<string> {
	const { stdout } = await execute('hc', args, {
		env: environmentAs(caller),
		timeout: TIMEOUT_MS,
		maxBuffer: MAX_OUTPUT_BYTES,
	})
	return stdout
}

function parse<Schema extends TSchema>(
	schema: Schema,
	text: string,
): Static<Schema> {
	const parsed: unknown = JSON.parse(text)
	return Value.Parse(schema, parsed)
}

function isGone(error: unknown): boolean {
	if (!(error instanceof Error) || !('code' in error)) return false
	return GONE_EXIT_CODES.some(code => code === error.code)
}

function toTerminal(record: Static<typeof RecordSchema>): Terminal {
	return {
		address: record.address,
		name: record.name,
		parent: record.parent,
		state: record.status?.state ?? null,
		app: record.status?.app ?? null,
		statusMs: record.status_ms ?? record.created_ms,
		turn: record.turn,
		cwd: record.foreground?.cwd ?? record.cwd,
		pid: record.foreground?.pid ?? null,
		diesWithParent: record.die_with_parent,
		labels: record.labels ?? {},
	}
}

export async function terminalAt(address: string): Promise<Terminal | null> {
	try {
		const record = parse(
			RecordSchema,
			await core(['get', address, '--json']),
		)
		if (record.state !== LIVE) return null
		return toTerminal(record)
	} catch (error) {
		if (isGone(error)) return null
		throw error
	}
}

export async function liveTerminals(): Promise<Terminal[]> {
	const listing = parse(ListingSchema, await core(['ls', '--json']))
	const live = listing.terminals.filter(listed => listed.state === LIVE)
	const described = await Promise.all(
		live.map(listed => terminalAt(listed.address)),
	)
	return described.filter(terminal => terminal !== null)
}

export function readScreen(address: string, lines: number): Promise<string> {
	return core(['read', address, '--lines', String(lines)])
}

export async function screenFingerprint(address: string): Promise<string> {
	return createHash('sha256')
		.update(await readScreen(address, 0))
		.digest('hex')
}

// A kill made as nobody types an exit note into the owner and starts a turn there; made as the owner, it types none.
// `hc kill` without `hc rm` keeps the finished record, so `hc read` still prints the last screen.
export async function endTerminal(
	address: string,
	owner: string | null,
): Promise<void> {
	try {
		await core(['kill', address], owner)
	} catch (error) {
		if (!isGone(error)) throw error
	}
}

export async function labelTerminal(
	address: string,
	label: string,
	shown: string,
): Promise<void> {
	await core(['label', address, `${label}=${shown}`])
}

export async function startTerminal(args: string[]): Promise<string> {
	const started = await core(['run', '--bg', '--json', ...args])
	return parse(StartedSchema, started).address
}
