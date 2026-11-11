import { join } from 'node:path'

import { Type } from 'typebox'

import { clientFiles } from '#lib/client-overlays.ts'
import { GROUP_PREFIX } from '#lib/magpie.ts'

import { readCheckedJson } from './checked-json.ts'

import type { Static } from 'typebox'

export const SPEC_FILE = 'magpie-routing.json'
/** Magpie refuses a longer intent. */
const MAX_INTENT_LENGTH = 200

const GroupReference = Type.String({ pattern: `^${GROUP_PREFIX}[a-z0-9-]+$` })
const NonEmptyStrings = Type.Array(Type.String({ minLength: 1 }), {
	minItems: 1,
})
/** Magpie takes a scope's folders as one comma-separated value. */
const Folders = Type.Array(Type.String({ pattern: '^[^,]+$' }), {
	minItems: 1,
})

const RoutingRuleSchema = Type.Object(
	{
		intent: Type.Optional(Type.String({ minLength: 1 })),
		scope: Type.Optional(Type.String({ minLength: 1 })),
		use: Type.Array(GroupReference, { minItems: 1, uniqueItems: true }),
	},
	{ additionalProperties: false },
)

const RoutingSpecSchema = Type.Object(
	{
		group: Type.String({ pattern: '^[a-z0-9-]+$' }),
		classifier: Type.String({ minLength: 1 }),
		intentSure: Type.Number({ minimum: 0, maximum: 1 }),
		members: Type.Array(GroupReference, { minItems: 1, uniqueItems: true }),
		scopes: Type.Record(Type.String(), Folders),
		intents: Type.Record(
			Type.String(),
			Type.String({ minLength: 1, maxLength: MAX_INTENT_LENGTH }),
		),
		rules: Type.Array(RoutingRuleSchema, { minItems: 1 }),
		pins: Type.Record(Type.String(), NonEmptyStrings),
	},
	{ additionalProperties: false },
)

const RoutingOverlaySchema = Type.Object(
	{
		scopes: Type.Optional(Type.Record(Type.String(), Folders)),
		rules: Type.Optional(Type.Array(RoutingRuleSchema)),
	},
	{ additionalProperties: false },
)

export type RoutingRule = Static<typeof RoutingRuleSchema>
export type RoutingSpec = Static<typeof RoutingSpecSchema>
type RoutingOverlay = Static<typeof RoutingOverlaySchema>

function unknownMembers(spec: RoutingSpec, groups: string[]): string[] {
	return groups.filter(group => !spec.members.includes(group))
}

function ruleProblems(
	spec: RoutingSpec,
	rule: RoutingRule,
	index: number,
): string[] {
	const where = `rules[${index}]`
	const problems = unknownMembers(spec, rule.use).map(
		group => `${where} uses ${group}, not a member`,
	)
	if (!rule.intent && !rule.scope)
		problems.push(
			`${where} has no intent or scope: it would catch every turn`,
		)
	if (rule.intent && !Object.hasOwn(spec.intents, rule.intent))
		problems.push(`${where} names unknown intent "${rule.intent}"`)
	if (rule.scope && !Object.hasOwn(spec.scopes, rule.scope))
		problems.push(`${where} names unknown scope "${rule.scope}"`)
	return problems
}

function specProblems(spec: RoutingSpec): string[] {
	const pinProblems = unknownMembers(spec, Object.keys(spec.pins)).map(
		group => `pins.${group} is not a member`,
	)
	const classifierProblems = spec.rules.some(rule => rule.intent)
		? []
		: ['no rule has an intent: the classifier would never run']
	return [
		...spec.rules.flatMap((rule, index) => ruleProblems(spec, rule, index)),
		...pinProblems,
		...classifierProblems,
	]
}

/** Client rules go right before the first scoped base rule, so an unscoped rule placed earlier, such as an explicit directive, still wins. */
function withOverlay(
	spec: RoutingSpec,
	overlay: RoutingOverlay,
	path: string,
): RoutingSpec {
	const scopes = overlay.scopes ?? {}
	const clashes = Object.keys(scopes).filter(scope =>
		Object.hasOwn(spec.scopes, scope),
	)
	if (clashes.length)
		throw new Error(`${path} redefines scope ${clashes.join(', ')}`)
	const firstScoped = spec.rules.findIndex(rule => rule.scope)
	const insertAt = firstScoped === -1 ? spec.rules.length : firstScoped
	return {
		...spec,
		scopes: { ...spec.scopes, ...scopes },
		rules: spec.rules.toSpliced(insertAt, 0, ...(overlay.rules ?? [])),
	}
}

/** The agent directory's spec, with every `client/<name>/` spec merged in. */
export function loadRoutingSpec(agentDir: string): RoutingSpec {
	const path = join(agentDir, SPEC_FILE)
	const spec = clientFiles(agentDir, SPEC_FILE).reduce(
		(merged, overlayPath) =>
			withOverlay(
				merged,
				readCheckedJson(overlayPath, RoutingOverlaySchema),
				overlayPath,
			),
		readCheckedJson(path, RoutingSpecSchema),
	)
	const problems = specProblems(spec)
	if (problems.length)
		throw new Error(`invalid ${path}: ${problems.join('; ')}`)
	return spec
}
