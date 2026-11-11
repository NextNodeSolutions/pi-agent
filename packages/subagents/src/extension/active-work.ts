import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentState } from "../shared/types.ts";

/**
 * Read-only count of the work that will wake this session on its own, for
 * sibling Pi extensions (`extensions/ui/herdr-status` reports it to Herdr as
 * a terminal label): queued or running async subagent runs, and armed
 * `bg_wait` subscriptions. Same request/answer shape as the agent roster
 * event: the caller emits a request whose `result` this runtime fills in
 * synchronously.
 */
export const ACTIVE_WORK_EVENT = "pi-subagents:active-work:v1";
export const ACTIVE_WORK_VERSION = 1 as const;

export interface ActiveWorkPayload {
	version: typeof ACTIVE_WORK_VERSION;
	asyncRuns: number;
	waitSubscriptions: number;
}

export interface ActiveWorkRequest {
	version: typeof ACTIVE_WORK_VERSION;
	/** Filled in by the installed runtime; a caller never sets it. */
	result?: ActiveWorkPayload | { error: string };
}

export function countActiveWork(state: Pick<SubagentState, "asyncJobs" | "waitSubscriptions">, now = Date.now()): Omit<ActiveWorkPayload, "version"> {
	const asyncRuns = [...state.asyncJobs.values()].filter((job) => job.status === "queued" || job.status === "running").length;
	const waitSubscriptions = [...(state.waitSubscriptions?.values() ?? [])].filter((record) => record.expiresAt > now).length;
	return { asyncRuns, waitSubscriptions };
}

/** Answer active-work requests for this Pi process until the returned disposer runs. */
export function registerActiveWorkListener(pi: ExtensionAPI, state: Pick<SubagentState, "asyncJobs" | "waitSubscriptions">): () => void {
	return pi.events.on(ACTIVE_WORK_EVENT, (rawRequest) => {
		if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) return;
		const request = rawRequest as Record<string, unknown>;
		if (request.result !== undefined) return;
		if (request.version !== ACTIVE_WORK_VERSION) {
			request.result = { error: `Unsupported active work event version '${String(request.version)}'.` } satisfies { error: string };
			return;
		}
		request.result = { version: ACTIVE_WORK_VERSION, ...countActiveWork(state) } satisfies ActiveWorkPayload;
	});
}
