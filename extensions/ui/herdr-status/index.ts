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
 * `agent.title`: the session's name, generated from its first human prompt
 * by `title.ts`; the Herdr `agent-naming` mod names the tab after it.
 *
 * `pi.session` (`SESSION_LABEL`): the interactive session's file, so a
 * terminal this session relays to with `hc send` can read the human answers
 * behind the relay (`#lib/test-pace/relay-evidence.ts`).
 */
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { SESSION_LABEL } from '#lib/hc-relay.ts'
import {
	BASH_JOBS_EVENT,
	BASH_JOBS_VERSION,
	BashJobsPayloadSchema,
} from '#lib/tools/bash-jobs-event.ts'

import { registerSessionTitle } from './title.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'

/** The event `pi-subagents` answers; its producer owns the payload's version. */
const ACTIVE_WORK_EVENT = 'pi-subagents:active-work:v1'
const ACTIVE_WORK_VERSION = 1
const WAITING_LABEL = 'agent.waiting'
const TITLE_LABEL = 'agent.title'

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
	pi.on('agent_settled', () => {
		void label(WAITING_LABEL, pendingWork(pi))
	})
	registerSessionTitle(pi, title => label(TITLE_LABEL, title))
	pi.on('session_start', (_event, ctx) => {
		if (ctx.hasUI)
			void label(SESSION_LABEL, ctx.sessionManager.getSessionFile() ?? '')
	})
	pi.on('session_shutdown', () => {
		void label(WAITING_LABEL, '')
		void label(TITLE_LABEL, '')
		void label(SESSION_LABEL, '')
	})
}
