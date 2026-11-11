/**
 * ask_user_secret: the one way a secret typed by the human reaches a tool.
 * The dialog (secret-dialog.ts) masks the entry; the value then either parks
 * in the in-process handoff (secret-store.ts) under a one-time, origin-bound
 * handle that frontend_batch claims, or goes to Infisical through the house
 * script (infisical-write.ts). schema.ts owns the boundary shapes,
 * request.ts validates the destination, transcript.ts renders the cards. The
 * model and the transcript only ever see handles, key names and statuses.
 */
import { Text } from '@earendil-works/pi-tui'

import { TranscriptComponent } from '#lib/ui/transcript-component.ts'

import { writeSecret } from './infisical-write.ts'
import { describeRequest, parseRequest } from './request.ts'
import { SecretParams } from './schema.ts'
import { showSecretDialog } from './secret-dialog.ts'
import { secretHandoff } from './secret-store.ts'
import {
	parseSecretResult,
	renderCallLines,
	renderResultLines,
} from './transcript.ts'

import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { SecretParamsType, SecretResult } from './schema.ts'

interface RowState {
	answered?: boolean
}

const MS_PER_SECOND = 1000

const TOOL_DESCRIPTION =
	'Ask the human for a secret (password, token, one-time code, API key) through a masked local dialog that never echoes, logs or returns the value. Use it whenever a flow needs a value the human holds; never ask for a secret in chat and never accept one typed there. destination=browser parks the value under a one-time handle bound to the exact origin you pass (the current page origin, scheme://host[:port]); pass that handle as `secret` on a frontend_batch type step within 3 minutes, and only that origin can consume it. destination=infisical writes the value to the given project/environment/path/name through the vault script and returns the key name only; an existing name needs replace=true. Describe in purpose what the value unlocks, in product terms, so the human knows what to type. Requires the interactive terminal. If the human cancels, stop that flow and say so.'

export default function askUserSecret(pi: ExtensionAPI): void {
	pi.registerTool<typeof SecretParams, SecretResult, RowState>({
		name: 'ask_user_secret',
		label: 'Ask User Secret',
		description: TOOL_DESCRIPTION,
		parameters: SecretParams,
		executionMode: 'sequential',
		renderShell: 'self',
		execute: (...[, params, signal, , context]) =>
			runSecretTool(params, context, signal),
		renderCall(args, _theme, context) {
			return new TranscriptComponent(width =>
				context.state.answered ? [] : renderCallLines(args, width),
			)
		},
		renderResult(toolResult, _options, _theme, context) {
			if (!context.state.answered) {
				// oxlint-disable-next-line eslint/no-param-reassign - Pi owns this mutable cross-slot state channel
				context.state.answered = true
				// Do not reenter Pi's in-flight display update synchronously.
				queueMicrotask(() => context.invalidate())
			}
			const details = parseSecretResult(toolResult.details)
			if (details)
				return new TranscriptComponent(width =>
					renderResultLines(details, width),
				)
			const text = toolResult.content
				.flatMap(part => (part.type === 'text' ? [part.text] : []))
				.join('\n')
			return new Text(text, 0, 0)
		},
	})
}

async function runSecretTool(
	params: SecretParamsType,
	context: ExtensionContext,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<SecretResult>> {
	if (context.mode !== 'tui')
		throw new Error('ask_user_secret requires interactive TUI mode')
	const request = parseRequest(params)
	const typedSecret = await showSecretDialog(context, signal, {
		kind: params.kind,
		purpose: params.purpose,
		destination: describeRequest(request),
	})
	if (!typedSecret) return settledResult({ status: 'cancelled' })
	if (request.destination === 'browser') {
		const { handle, expiresAt } = secretHandoff().issue(
			typedSecret,
			request.origin,
		)
		return settledResult({
			status: 'issued',
			handle,
			origin: request.origin,
			expiresAt,
		})
	}
	const stored = await writeSecret(
		request.target,
		request.shouldReplace,
		typedSecret,
		signal,
	)
	return settledResult({ status: 'stored', ...stored })
}

function settledResult(details: SecretResult): AgentToolResult<SecretResult> {
	return { content: [{ type: 'text', text: resultText(details) }], details }
}

function resultText(details: SecretResult): string {
	switch (details.status) {
		case 'issued': {
			const seconds = Math.round(
				(details.expiresAt - Date.now()) / MS_PER_SECOND,
			)
			return `Secret handle ${details.handle} issued for ${details.origin}; one use, expires in ${seconds} s. Pass it as \`secret\` on a frontend_batch type step targeting the field on that origin.`
		}
		case 'stored':
			return `Secret ${details.operation} in ${details.target}. The value was not printed.`
		case 'cancelled':
			return 'User cancelled the secret request; no value was entered.'
	}
}
