/**
 * fallback - aborts a request the Magpie gateway stopped serving.
 *
 * A gateway that accepts connections but gets no CPU never fails a request:
 * pi waits its idle timeout out on every attempt. A slow reply is told apart
 * from a dead gateway by asking the gateway itself: while a request is silent
 * its model list is probed, and only unanswered probes abort the request.
 * The settled run then moves down the chain.
 */

import { MAGPIE_PROVIDER } from '#lib/magpie.ts'

import { currentModelReference, failoverAfterAbort } from './failover.ts'
import { GATEWAY_WATCH, GatewayLiveness } from './gateway-liveness.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { FailureSighting, FallbackSession } from './fallback-session.ts'

interface ArmedWatch {
	liveness: GatewayLiveness
	timer: NodeJS.Timeout
}

const HANG_REASON = `Magpie gateway unresponsive: ${GATEWAY_WATCH.failedProbesToAbort} probes unanswered`

async function isGatewayAnswering(baseUrl: string): Promise<boolean> {
	try {
		// Any HTTP status proves the gateway process is being scheduled; only silence counts as hung.
		const response = await fetch(`${baseUrl}/models`, {
			signal: AbortSignal.timeout(GATEWAY_WATCH.probeTimeoutMs),
		})
		await response.arrayBuffer()
		return true
	} catch {
		return false
	}
}

class GatewayWatchdog {
	private armed: ArmedWatch | undefined
	private hang: FailureSighting | undefined

	arm(ctx: ExtensionContext, baseUrl: string): void {
		this.disarm()
		const liveness = new GatewayLiveness(Date.now())
		const timer = setInterval(
			() => void this.probe(ctx, liveness, baseUrl),
			GATEWAY_WATCH.probeIntervalMs,
		)
		timer.unref()
		this.armed = { liveness, timer }
	}

	disarm(): void {
		clearInterval(this.armed?.timer)
		this.armed = undefined
	}

	noteActivity(): void {
		this.armed?.liveness.noteActivity(Date.now())
	}

	claimHang(): FailureSighting | undefined {
		const { hang } = this
		this.hang = undefined
		return hang
	}

	private async probe(
		ctx: ExtensionContext,
		liveness: GatewayLiveness,
		baseUrl: string,
	): Promise<void> {
		const startedAt = Date.now()
		if (!liveness.isSilent(startedAt)) return
		const isAnswered = await isGatewayAnswering(baseUrl)
		if (this.armed?.liveness !== liveness) return
		liveness.noteProbe({ startedAt, isAnswered })
		if (!liveness.isHung()) return
		this.disarm()
		this.hang = { model: currentModelReference(ctx), reason: HANG_REASON }
		ctx.abort()
	}
}

export function watchGateway(pi: ExtensionAPI, session: FallbackSession): void {
	const watchdog = new GatewayWatchdog()
	// turn_start, not before_provider_request: compaction requests stay unwatched.
	pi.on('turn_start', (_event, ctx) => {
		watchdog.disarm()
		const { model } = ctx
		if (!ctx.hasUI || model?.provider !== MAGPIE_PROVIDER) return
		if (session.currentConfig().autoFallback)
			watchdog.arm(ctx, model.baseUrl)
	})
	pi.on('after_provider_response', () => watchdog.noteActivity())
	pi.on('message_update', () => watchdog.noteActivity())
	pi.on('message_end', event => {
		if (event.message.role === 'assistant') watchdog.disarm()
	})
	pi.on('agent_end', () => watchdog.disarm())
	pi.on('session_shutdown', () => watchdog.disarm())
	pi.on('agent_settled', async (event, ctx) => {
		const failure = watchdog.claimHang()
		if (!failure || !event.aborted) return
		await failoverAfterAbort(pi, ctx, session, failure)
	})
}
