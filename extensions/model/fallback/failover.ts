/**
 * fallback - the model moves this extension performs, plus the status
 * line that goes with them.
 *
 * `performFailover` moves a session whose model just failed onto the next
 * usable model of the chain and asks the model to pick the interrupted task
 * back up, and `failoverAfterAbort` does the same for a run this extension
 * aborted itself; `restoreOriginal` returns the session to the model it started on,
 * either when a run settles cleanly on the fallback model or when a turn
 * boundary inside a long fallback run could use it again. A chain with no
 * usable model left also ends on the model the session started on. These are
 * the only callers of `pi.setModel`, and they own
 * their user-facing notification, so the decision stays in `FallbackSession`.
 */

import { FALLBACK_STATUS_KEY as STATUS_KEY } from '#lib/model-fallback/status.ts'

import { modelReference, parseModelReference } from './chain.ts'
import { continuationAfterFailover } from './fallback-message.ts'

import type {
	BoundaryResult,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { FallbackSession, FailureSighting } from './fallback-session.ts'

type RegistryModel = NonNullable<
	ReturnType<ExtensionContext['modelRegistry']['find']>
>

interface FailoverTarget {
	reference: string
	model: RegistryModel
}

/** The session's model as a chain reference (`provider/modelId`). */
export function currentModelReference(
	ctx: ExtensionContext,
): string | undefined {
	if (!ctx.model) return undefined
	return modelReference(ctx.model)
}

/** Ends the fallback: the session keeps its model and loses the status line. */
export function endFallback(
	ctx: ExtensionContext,
	session: FallbackSession,
): void {
	session.clearFallback()
	ctx.ui.setStatus(STATUS_KEY, undefined)
}

function findModel(
	ctx: ExtensionContext,
	reference: string,
): RegistryModel | undefined {
	const parsed = parseModelReference(reference)
	if (!parsed) return undefined
	return ctx.modelRegistry.find(parsed.provider, parsed.modelId)
}

/** The first candidate this machine can actually run right now. */
function resolveTarget(
	ctx: ExtensionContext,
	candidates: readonly string[],
): FailoverTarget | undefined {
	for (const reference of candidates) {
		const model = findModel(ctx, reference)
		if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) continue
		return { reference, model }
	}
	return undefined
}

/** Announces a switch the user has to know about: it changed their provider. */
function reportFallback(
	ctx: ExtensionContext,
	failure: FailureSighting,
	reference: string,
): void {
	ctx.ui.notify(
		`Fallback: ${failure.model ?? 'current model'} → ${reference} (${failure.reason})`,
		'warning',
	)
	ctx.ui.setStatus(STATUS_KEY, `↯ ${reference} (fallback)`)
}

/** Moves the session to the model it started on; false when it stays put. */
async function returnToOriginal(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
	reference: string,
): Promise<boolean> {
	const model = findModel(ctx, reference)
	if (!model) {
		endFallback(ctx, session)
		return false
	}
	session.trackSwitch(reference)
	if (!(await pi.setModel(model))) {
		session.forgetSwitch(reference)
		return false
	}
	endFallback(ctx, session)
	return true
}

/** The model the session started on, when a fallback session moved back to it. */
async function leaveFallback(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
): Promise<string | undefined> {
	const original = session.restoreModel()
	if (!original || original === currentModelReference(ctx)) return undefined
	if (!(await returnToOriginal(pi, ctx, session, original))) return undefined
	return original
}

/**
 * No chain model is left. The session goes back to the model it started on
 * even while that one cools down: nothing is re-requested here, and the next
 * prompt must not start on a fallback that just failed.
 */
async function abandonChain(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
	failure: FailureSighting,
): Promise<void> {
	const original = await leaveFallback(pi, ctx, session)
	const chain = session.currentConfig().chain.join(' → ') || 'empty'
	const landing = original ? ` The session is back on ${original}.` : ''
	ctx.ui.notify(
		`Model fallback exhausted after ${failure.model ?? 'the current model'} failed (${failure.reason}); chain: ${chain}.${landing} The interrupted request remains unfinished; resume it when a provider is available.`,
		'warning',
	)
}

async function switchToNextModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
	failure: FailureSighting,
): Promise<string | undefined> {
	const now = Date.now()
	session.coolDown(failure, now)
	const target = resolveTarget(
		ctx,
		session.candidatesAfter(failure.model, now),
	)
	if (!target) {
		await abandonChain(pi, ctx, session, failure)
		return undefined
	}
	session.trackSwitch(target.reference)
	if (await pi.setModel(target.model)) return target.reference
	session.forgetSwitch(target.reference)
	ctx.ui.notify(
		`fallback: no credentials configured for ${target.reference}.`,
		'error',
	)
	return undefined
}

/** Switch at agent_before_settle and return one same-request continuation. */
export async function performFailover(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
	failure: FailureSighting,
): Promise<BoundaryResult | undefined> {
	if (ctx.signal?.aborted) return undefined
	const sessionId = ctx.sessionManager.getSessionId()
	const candidate = await switchToNextModel(pi, ctx, session, failure)
	if (!candidate) return undefined
	if (ctx.signal?.aborted || sessionId !== ctx.sessionManager.getSessionId())
		return undefined
	session.markFallbackActive(failure.model)
	reportFallback(ctx, failure, candidate)
	return {
		entries: ctx.hasPendingMessages()
			? []
			: [
					{
						type: 'custom_message',
						...continuationAfterFailover(ctx, failure, candidate),
					},
				],
		continue: true,
	}
}

/** An aborted run has no settle boundary left to continue from: the continuation starts a new run. */
export async function failoverAfterAbort(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
	failure: FailureSighting,
): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId()
	const candidate = await switchToNextModel(pi, ctx, session, failure)
	if (!candidate || sessionId !== ctx.sessionManager.getSessionId()) return
	session.markFallbackActive(failure.model)
	reportFallback(ctx, failure, candidate)
	pi.sendMessage(continuationAfterFailover(ctx, failure, candidate), {
		triggerTurn: true,
	})
}

/** Return a session that ran cleanly to the model it started on. */
export async function restoreOriginal(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
): Promise<void> {
	const reference = session.restoreModel()
	if (!reference || reference === currentModelReference(ctx)) {
		endFallback(ctx, session)
		return
	}
	// Restoring a model that is still cooling down would flap straight back
	// into the failure that put this session on a fallback.
	if (session.isCoolingDown(reference, Date.now())) return
	if (await returnToOriginal(pi, ctx, session, reference))
		ctx.ui.notify(`Restored main model ${reference}.`, 'info')
}
