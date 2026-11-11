// What one in-flight request knows about the gateway's silence. Pure state -
// the caller owns the clock and the probe.

export const GATEWAY_WATCH = {
	silenceMs: 20_000,
	probeIntervalMs: 10_000,
	probeTimeoutMs: 5_000,
	failedProbesToAbort: 3,
} as const

export interface ProbeResult {
	startedAt: number
	isAnswered: boolean
}

export class GatewayLiveness {
	private lastActivityAt: number
	private failedProbes = 0

	constructor(now: number) {
		this.lastActivityAt = now
	}

	noteActivity(now: number): void {
		this.lastActivityAt = now
		this.failedProbes = 0
	}

	isSilent(now: number): boolean {
		return now - this.lastActivityAt >= GATEWAY_WATCH.silenceMs
	}

	noteProbe(probe: ProbeResult): void {
		// A probe sent before the last byte arrived says nothing about the silence after it.
		if (probe.startedAt < this.lastActivityAt) return
		this.failedProbes = probe.isAnswered ? 0 : this.failedProbes + 1
	}

	isHung(): boolean {
		return this.failedProbes >= GATEWAY_WATCH.failedProbesToAbort
	}
}
