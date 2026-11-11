// Which models the chain may not move to. A model that failed stays out for a
// TTL chosen by the kind of failure, and never comes back within the chain walk
// that saw it fail, so a walk ends even when every cooldown expires faster than
// one failing request lasts. Pure state - the caller owns the clock.

import { GROUP_PREFIX, MAGPIE_PROVIDER } from '#lib/magpie.ts'

import {
	activeExclusions,
	fallbackCandidates,
	recordExclusion,
} from './chain.ts'
import { isAccountStateFailure } from './taxonomy.ts'

import type { Exclusions } from './chain.ts'
import type { ModelFallbackConfig } from './config.ts'
import type { FailureSighting } from './fallback-session.ts'

type CooldownConfig = Pick<
	ModelFallbackConfig,
	'exclusionTtlMs' | 'accountExclusionTtlMs'
>

const ROUTING_GROUP_PREFIX = `${MAGPIE_PROVIDER}/${GROUP_PREFIX}`

/**
 * A routing group pools several accounts and reports the last one it asked:
 * a spent account behind it says every member failed this request, not that
 * the group stays down, so only a single-account model takes the long TTL.
 */
function hasSpentAccount(model: string, reason: string): boolean {
	return (
		!model.startsWith(ROUTING_GROUP_PREFIX) && isAccountStateFailure(reason)
	)
}

export class ModelCooldowns {
	private exclusions: Exclusions = new Map()
	private failedInWalk = new Set<string>()

	reset(): void {
		this.exclusions = new Map()
		this.failedInWalk = new Set()
	}

	/** Every cooldown recorded so far, expired ones included. */
	recorded(): ReadonlyMap<string, number> {
		return this.exclusions
	}

	recordFailure(
		failure: FailureSighting,
		now: number,
		config: CooldownConfig,
	): void {
		if (!failure.model) return
		const ttlMs = hasSpentAccount(failure.model, failure.reason)
			? config.accountExclusionTtlMs
			: config.exclusionTtlMs
		recordExclusion(this.exclusions, failure.model, now, ttlMs)
		this.failedInWalk.add(failure.model)
	}

	/** A model that just answered ends its own cooldown and the walk. */
	recordSuccess(model: string | undefined): void {
		if (model) this.exclusions.delete(model)
		this.endWalk()
	}

	endWalk(): void {
		this.failedInWalk.clear()
	}

	isCoolingDown(model: string, now: number): boolean {
		return activeExclusions(this.exclusions, now).has(model)
	}

	candidatesAfter(
		failedModel: string | undefined,
		chain: readonly string[],
		now: number,
	): string[] {
		const unreachable = new Set([
			...activeExclusions(this.exclusions, now),
			...this.failedInWalk,
		])
		return fallbackCandidates(failedModel, chain, unreachable)
	}
}
