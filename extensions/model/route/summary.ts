import { GROUP_PREFIX } from '#lib/magpie.ts'

import { SPEC_FILE } from './spec.ts'

import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { RoutingRule, RoutingSpec } from './spec.ts'

export const APPLY = 'apply'
export const RELEASE = 'auto'

function ruleLine(rule: RoutingRule, index: number): string {
	const label = rule.intent ?? 'any intent'
	const scoped = rule.scope ? `${label} in ${rule.scope}` : label
	return `${index + 1}. ${scoped} → ${rule.use.join(' → ')}`
}

export function describeRouting(
	spec: RoutingSpec,
	pin: string | undefined,
): string {
	const pinLine = pin
		? `Pinned: ${pin} (/route ${RELEASE} releases it)`
		: `No pin: ${GROUP_PREFIX}${spec.group} classifies each turn`
	const pinPhrases = Object.entries(spec.pins).map(
		([group, phrases]) => `${group} ← ${phrases.join(', ')}`,
	)
	return [
		pinLine,
		...spec.rules.map(ruleLine),
		`no match → ${spec.members.join(' → ')}`,
		'Pin phrases:',
		...pinPhrases,
		`Edit ${SPEC_FILE}, then /route ${APPLY}`,
	].join('\n')
}

export function routeCompletions(
	spec: RoutingSpec,
	prefix: string,
): AutocompleteItem[] | null {
	const typed = prefix.trim()
	const matches = [
		APPLY,
		RELEASE,
		...spec.members.map(member => member.slice(GROUP_PREFIX.length)),
	]
		.filter(word => word.startsWith(typed))
		.map(word => ({ value: word, label: word }))
	if (!matches.length) return null
	return matches
}
