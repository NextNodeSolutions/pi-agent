/** Shapes crossing the ask_user_secret boundary: tool input and replayed result. */
import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import {
	ENVIRONMENT_PATTERN,
	PROJECT_ID_PATTERN,
	SECRET_NAME_PATTERN,
	SECRET_PATH_PATTERN,
} from '../../../security/infisical-target.ts'

import type { Static } from 'typebox'

export const SECRET_KINDS = ['password', 'token', 'code', 'other'] as const
export const DESTINATIONS = ['browser', 'infisical'] as const

export const InfisicalTargetParams = Type.Object({
	projectId: Type.String({ pattern: PROJECT_ID_PATTERN }),
	environment: Type.String({ pattern: ENVIRONMENT_PATTERN }),
	path: Type.Optional(
		Type.String({
			pattern: SECRET_PATH_PATTERN,
			description: 'Folder path, default "/".',
		}),
	),
	name: Type.String({ pattern: SECRET_NAME_PATTERN }),
	replace: Type.Optional(
		Type.Boolean({
			description:
				'Overwrite an existing secret of that name. Without it an existing name is refused.',
		}),
	),
})

export const SecretParams = Type.Object({
	purpose: Type.String({
		minLength: 1,
		maxLength: 200,
		description:
			'What the secret is, for the human: the account or site, and what it unlocks. Never the value.',
	}),
	kind: StringEnum(SECRET_KINDS, {
		description: 'Label shown to the human; it changes no behavior.',
	}),
	destination: StringEnum(DESTINATIONS, {
		description:
			'browser: the value is parked under a one-time handle for a frontend_batch type step on that origin. infisical: the value is written to the vault and only its key name comes back.',
	}),
	origin: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 2000,
			description:
				'Required for browser: the exact origin the field lives on, scheme://host[:port], as the current page reports it.',
		}),
	),
	infisical: Type.Optional(InfisicalTargetParams),
})

export const SecretResultSchema = Type.Union([
	Type.Object({
		status: Type.Literal('issued'),
		handle: Type.String(),
		origin: Type.String(),
		expiresAt: Type.Number(),
	}),
	Type.Object({
		status: Type.Literal('stored'),
		target: Type.String(),
		operation: Type.String(),
	}),
	Type.Object({ status: Type.Literal('cancelled') }),
])

export type SecretParamsType = Static<typeof SecretParams>
export type SecretResult = Static<typeof SecretResultSchema>
