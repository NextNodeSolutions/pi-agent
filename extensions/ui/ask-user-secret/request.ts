/** Validated request: what the dialog shows and where the value goes. */
import {
	describeTarget,
	parseSecretTarget,
} from '../../../security/infisical-target.ts'

import type { SecretTarget } from '../../../security/infisical-target.ts'
import type { SecretParamsType } from './schema.ts'

export type SecretRequest =
	| { destination: 'browser'; origin: string }
	| {
			destination: 'infisical'
			target: SecretTarget
			shouldReplace: boolean
	  }

export function parseRequest(params: SecretParamsType): SecretRequest {
	if (params.destination === 'browser')
		return { destination: 'browser', origin: exactOrigin(params.origin) }
	if (!params.infisical)
		throw new Error('destination=infisical requires the infisical target.')
	return {
		destination: 'infisical',
		target: parseSecretTarget({
			projectId: params.infisical.projectId,
			environment: params.infisical.environment,
			path: params.infisical.path ?? '/',
			name: params.infisical.name,
		}),
		shouldReplace: params.infisical.replace ?? false,
	}
}

function exactOrigin(text: string | undefined): string {
	if (!text) throw new Error('destination=browser requires origin.')
	let url: URL
	try {
		url = new URL(text)
	} catch {
		throw new Error('origin must be a URL: scheme://host[:port].')
	}
	if (url.origin !== text || !/^https?:$/.test(url.protocol))
		throw new Error(
			`origin must be the exact http(s) origin, e.g. ${url.origin}.`,
		)
	return url.origin
}

/** The destination line the human reads before typing. */
export function describeRequest(request: SecretRequest): string {
	if (request.destination === 'browser')
		return `browser field on ${request.origin}`
	return `Infisical ${describeTarget(request.target)}${request.shouldReplace ? ' (replace)' : ''}`
}
