import { vaultApi } from './machine-identity.ts'

import type { SecretLocation } from './infisical-target.ts'

export const TIMEOUT_MS = 30_000
export const HTTP_OK = 200

export function secretsApi(): string {
	return `${vaultApi()}/v3/secrets/raw`
}

export interface ApiResponse {
	status: number
	json: Record<string, unknown>
}

function jsonBody(body: unknown): { body: string } | undefined {
	if (!body) return undefined
	return { body: JSON.stringify(body) }
}

function jsonFields(json: unknown): Record<string, unknown> {
	if (typeof json !== 'object' || json === null) return {}
	return { ...json }
}

export async function call(
	token: string,
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
	url: string,
	body?: unknown,
): Promise<ApiResponse> {
	const response = await fetch(url, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		...jsonBody(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const json: unknown = await response.json().catch(() => ({}))
	return {
		status: response.status,
		json: jsonFields(json),
	}
}

export function query(where: SecretLocation, path: string): string {
	return new URLSearchParams({ ...where, secretPath: path }).toString()
}

/** Key names at one location; the only secret field this module ever reads back. */
export async function names(
	token: string,
	where: SecretLocation,
	path: string,
): Promise<string[]> {
	const { status, json } = await call(
		token,
		'GET',
		`${secretsApi()}?${query(where, path)}`,
	)
	if (status !== HTTP_OK)
		throw new Error(`Cannot list ${where.environment}: HTTP ${status}`)
	const { secrets } = json
	if (!Array.isArray(secrets)) throw new Error('Unexpected listing format')
	return secrets.flatMap((secret: unknown) => {
		const key =
			typeof secret === 'object' && secret !== null
				? Reflect.get(secret, 'secretKey')
				: undefined
		return typeof key === 'string' ? [key] : []
	})
}
