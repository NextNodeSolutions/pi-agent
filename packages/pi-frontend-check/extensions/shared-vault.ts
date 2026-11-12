import { execFile } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import identity from '../../../security/machine-identity.json' with { type: 'json' }

import type { Static } from 'typebox'

const run = promisify(execFile)
const broker = fileURLToPath(
	new URL('../shared-web-logins/broker.py', import.meta.url),
)
const HANDLE_PATTERN = '^iw:[a-f0-9]{32}$'
const handlePattern = new RegExp(HANDLE_PATTERN)
const MAX_BROKER_OUTPUT_BYTES = 524_288

const metadataSchema = Type.Object({
	handle: Type.String({ pattern: HANDLE_PATTERN }),
	origin: Type.String(),
	identifier: Type.String(),
	label: Type.String(),
	identifier_type: Type.String(),
	has_otp: Type.Boolean(),
})
const loginSchema = Type.Object({
	...metadataSchema.properties,
	password: Type.String(),
	otp_secret: Type.Optional(Type.String()),
})
export type SharedLoginMetadata = Static<typeof metadataSchema>
export const sharedLoginHandleSchema = metadataSchema.properties.handle
type SharedLogin = Static<typeof loginSchema>

function brokerFailure(error: unknown): Error {
	// Only the exit code is safe: child output and error causes can carry a password.
	const isIdentityUnavailable =
		error instanceof Error &&
		'code' in error &&
		error.code === identity.identityUnavailableExitCode
	return new Error(
		isIdentityUnavailable
			? 'Shared web-login vault unavailable: machine credentials are missing or refused, or the configured vault location is missing or inaccessible. Check the machine environment and vault configuration. Do not re-enter the website password.'
			: 'Shared web-login vault unavailable. Do not re-enter the password yet.',
	)
}

async function callBroker(
	action: 'list' | 'read',
	handle?: string,
	signal?: AbortSignal,
): Promise<unknown> {
	try {
		const { stdout } = await run(
			'/usr/bin/python3',
			[broker, action, ...(handle ? [handle] : [])],
			{
				timeout: 30_000,
				maxBuffer: MAX_BROKER_OUTPUT_BYTES,
				signal,
				env: {
					HOME: homedir(),
					PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
					TMPDIR: process.env.TMPDIR ?? tmpdir(),
					USER: process.env.USER ?? '',
					LOGNAME: process.env.LOGNAME ?? '',
					[identity.clientIdVariable]:
						process.env[identity.clientIdVariable],
					[identity.clientSecretVariable]:
						process.env[identity.clientSecretVariable],
				},
			},
		)
		return JSON.parse(stdout)
	} catch (error: unknown) {
		throw brokerFailure(error)
	}
}

export async function listSharedLogins(
	signal?: AbortSignal,
): Promise<SharedLoginMetadata[]> {
	const records = await callBroker('list', undefined, signal)
	if (
		!Array.isArray(records) ||
		!records.every((record: unknown) => Value.Check(metadataSchema, record))
	)
		throw new Error('Shared web-login vault returned invalid metadata.')
	return records
}

export async function readSharedLogin(
	handle: string,
	signal?: AbortSignal,
): Promise<SharedLogin> {
	if (!handlePattern.test(handle))
		throw new Error('Invalid shared login handle.')
	const record = await callBroker('read', handle, signal)
	if (!Value.Check(loginSchema, record) || record.handle !== handle)
		throw new Error('Shared web-login vault returned an invalid record.')
	return record
}
