/**
 * Reports to Herdr (herdr-core, `hc`) what it should know about this session,
 * as terminal labels (`hc label`); an empty value removes a label. Nothing
 * runs outside an hc terminal (`HC_TERMINAL_ID` unset).
 *
 * `agent.waiting`: what will wake this session on its own once a run settles:
 * queued or running async subagents, armed `bg_wait` subscriptions and shell
 * jobs whose result the session awaits (a foreground command that outlived
 * its window; a background start such as a server never completes on its own
 * and is not counted). The Herdr agent strip shows it as "waiting" instead of
 * "idle". The counts come over `pi.events`: `pi-subagents:active-work:v1`
 * from `packages/subagents/src/extension/active-work.ts` and the bash jobs
 * event from `#lib/tools/bash-jobs-event.ts`, answered by `tools/guard`. Each
 * answer crosses a boundary, so it is parsed against its schema and an answer
 * that does not match counts as no answer.
 *
 * `agent.goal`: the open items of the session's goal checklist (`goal.ts`),
 * empty once every item is ticked; the lifecycle sweeper
 * (`skills/agent-lifecycle`) keeps a terminal open while it is set.
 *
 * `agent.title`: the session's name, generated from its first human prompt
 * by `title.ts`; the Herdr `agent-naming` mod names the tab after it.
 *
 * `agent.read.<this terminal>`, set on another terminal: when this session
 * read that terminal's screen with `hc read` (`receipt.ts`); the lifecycle
 * sweeper takes a read after a helper finished as its result received.
 */
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import {
	BASH_JOBS_EVENT,
	BASH_JOBS_VERSION,
	BashJobsPayloadSchema,
} from '#lib/tools/bash-jobs-event.ts'
import {
	GOAL_LABEL,
	SESSION_LABEL,
	TITLE_LABEL,
	WAITING_LABEL,
} from '#lib/ui/herdr-labels.ts'

import { registerGoalLabel } from './goal.ts'
import { registerReadReceipts } from './receipt.ts'
import { registerSessionTitle } from './title.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'

/** The event `pi-subagents` answers; its producer owns the payload's version. */
const ACTIVE_WORK_EVENT = 'pi-subagents:active-work:v1'
const ACTIVE_WORK_VERSION = 1

const ActiveWorkPayloadSchema = Type.Object({
	version: Type.Literal(ACTIVE_WORK_VERSION),
	asyncRuns: Type.Integer({ minimum: 0 }),
	waitSubscriptions: Type.Integer({ minimum: 0 }),
})

interface BusRequest {
	version: number
	result?: unknown
}

function ask<Schema extends TSchema>(
	pi: Pick<ExtensionAPI, 'events'>,
	event: string,
	version: number,
	schema: Schema,
): ReturnType<typeof Value.Parse<Schema>> | undefined {
	const request: BusRequest = { version }
	pi.events.emit(event, request)
	try {
		return Value.Parse(schema, request.result)
	} catch {
		return undefined
	}
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function pendingWork(pi: Pick<ExtensionAPI, 'events'>): string {
	const parts: string[] = []
	const work = ask(
		pi,
		ACTIVE_WORK_EVENT,
		ACTIVE_WORK_VERSION,
		ActiveWorkPayloadSchema,
	)
	if (work) {
		if (work.asyncRuns > 0) parts.push(plural(work.asyncRuns, 'subagent'))
		if (work.waitSubscriptions > 0)
			parts.push(plural(work.waitSubscriptions, 'wait subscription'))
	}
	const jobs = ask(
		pi,
		BASH_JOBS_EVENT,
		BASH_JOBS_VERSION,
		BashJobsPayloadSchema,
	)
	if (jobs && jobs.awaited > 0) parts.push(plural(jobs.awaited, 'shell job'))
	return parts.join(', ')
}

export default function herdrStatus(pi: ExtensionAPI): void {
	const terminal = process.env.HC_TERMINAL_ID
	if (!terminal) return
	const label = async (key: string, shown: string): Promise<void> => {
		try {
			await pi.exec('hc', ['label', terminal, `${key}=${shown}`])
		} catch {
			return
		}
	}
	const publishSession = (ctx: ExtensionContext): void => {
		if (ctx.hasUI)
			void label(SESSION_LABEL, ctx.sessionManager.getSessionFile() ?? '')
	}
	pi.on('session_start', (_event, ctx) => publishSession(ctx))
	pi.on('agent_settled', (_event, ctx) => publishSession(ctx))
	registerGoalLabel(pi, open => label(GOAL_LABEL, open))
	registerReadReceipts(pi, terminal)
	pi.on('agent_settled', () => {
		void label(WAITING_LABEL, pendingWork(pi))
	})
	registerSessionTitle(pi, title => label(TITLE_LABEL, title))
	pi.on('session_shutdown', () => {
		void label(WAITING_LABEL, '')
		void label(TITLE_LABEL, '')
	})
}
