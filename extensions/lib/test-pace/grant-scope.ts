import { consentPaths } from './consent-scope.ts'
import { allowsKind } from './permission.ts'
import { classifyScopePath } from './scope-path.ts'

import type { ConsentPaths } from './consent-scope.ts'
import type { Evidence } from './evidence.ts'
import type { ConsentVerdict } from './permission.ts'

/** `answered`: Jev read every path it was asked about. */
type Scoped = ConsentPaths & { answered: boolean }
type Grant = { verdict: ConsentVerdict; scope: string[]; excluded?: string[] }

export const UNSCOPED: Scoped = { scope: [], excluded: [], answered: true }

/** A path Jev did not read leaves the exchange granting nothing and its judgment unrecorded, so it is read again. */
export async function grantScope(
	root: string,
	evidence: Evidence,
): Promise<Scoped> {
	let isEveryPathRead = true
	const paths = await consentPaths(
		root,
		async written => {
			const decision = await classifyScopePath(evidence, written)
			isEveryPathRead &&= Boolean(decision.answer)
			return decision.isCovered
		},
		[evidence.scopeText ?? evidence.question, evidence.reply],
	)
	return isEveryPathRead
		? { ...paths, answered: true }
		: { ...UNSCOPED, answered: false }
}

/** A grant naming no path covers what the active grants before it allowing its edit kind cover, minus what either excludes, never the whole repository. */
export function inheritedScopes<Each extends Grant>(
	grants: readonly Each[],
): Each[] {
	return grants.map((grant, index) => {
		if (grant.scope.length) return grant
		const lenders = grants
			.slice(0, index)
			.filter(before => allowsKind(before.verdict, grant.verdict))
		const excluded = [grant, ...lenders].flatMap(
			each => each.excluded ?? [],
		)
		return {
			...grant,
			scope: Array.from(new Set(lenders.flatMap(before => before.scope))),
			excluded: Array.from(new Set(excluded)),
		}
	})
}
