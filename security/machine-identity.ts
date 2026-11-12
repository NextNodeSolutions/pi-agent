// Tokens stay in memory or the CLI child's environment, never argv or output.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import protocol from './machine-identity.json' with { type: 'json' }

const BINDING_FILE = join(
	homedir(),
	'.config',
	'agent-secrets',
	'core-vault.json',
)
const LOGIN_TIMEOUT_MS = 10_000
const HTTP_BAD_REQUEST = 400
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR = 500

export class MachineIdentityUnavailable extends Error {
	override name = 'MachineIdentityUnavailable'
}

export class VaultUnreachable extends Error {
	override name = 'VaultUnreachable'
}

function field(json: unknown, name: string): unknown {
	if (typeof json !== 'object' || json === null) return undefined
	return Reflect.get(json, name)
}

function isIdentityRefusal(status: number): boolean {
	return (
		status >= HTTP_BAD_REQUEST &&
		status < HTTP_SERVER_ERROR &&
		status !== HTTP_TOO_MANY_REQUESTS
	)
}

export function vaultApi(): string {
	let binding: unknown
	try {
		binding = JSON.parse(readFileSync(BINDING_FILE, 'utf8'))
	} catch {
		throw new VaultUnreachable(
			`Cannot read the vault binding ${BINDING_FILE}`,
		)
	}
	const domain = field(binding, 'domain')
	if (typeof domain !== 'string' || !domain.startsWith('https://'))
		throw new VaultUnreachable(
			`${BINDING_FILE} names no https vault domain`,
		)
	return domain.replace(/\/+$/u, '')
}

export async function machineToken(): Promise<string> {
	const clientId = process.env[protocol.clientIdVariable]
	const clientSecret = process.env[protocol.clientSecretVariable]
	if (!clientId || !clientSecret)
		throw new MachineIdentityUnavailable(
			`No Infisical machine identity: ${protocol.clientIdVariable} and ${protocol.clientSecretVariable} must be in the environment. Start the session from a shell that exports them`,
		)
	const loginUrl = `${vaultApi()}/v1/auth/universal-auth/login`
	const response = await fetch(loginUrl, {
		method: 'POST',
		redirect: 'error',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ clientId, clientSecret }),
		signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
	}).catch(() => {
		throw new VaultUnreachable(
			'Infisical did not answer the machine identity login',
		)
	})
	if (isIdentityRefusal(response.status))
		throw new MachineIdentityUnavailable(
			`Infisical refused the machine identity: HTTP ${response.status}. Check that its client secret still exists`,
		)
	const body: unknown = response.ok
		? await response.json().catch(() => undefined)
		: undefined
	const token = field(body, 'accessToken')
	if (typeof token !== 'string' || !token || /\s/u.test(token))
		throw new VaultUnreachable(
			`Infisical returned no machine access token: HTTP ${response.status}`,
		)
	return token
}
