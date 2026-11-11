/**
 * tailnet-links - make what the final assistant message names open on any
 * device.
 *
 * A finished assistant message (no tool call left to run) goes through the
 * `tailnet-link rewrite` command of the tailnet-links skill, on the machine
 * that holds the project: a local document path becomes a published HTTPS
 * URL and a localhost URL becomes an HTTPS preview. That command owns every
 * rule (which files, which ports, which machine); this extension only carries
 * the text there and back (`rewrite.ts`) and tells the human when a link could
 * not be made. A failed round trip leaves the message as written.
 *
 * It also puts the skill's `dev-server.env` into Pi's environment, so a dev
 * server started from a Pi that no shell of the machine launched still accepts
 * requests for the tailnet host.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { rewriteTexts } from './rewrite.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const DEV_SERVER_ENVIRONMENT = 'skills/tailnet-links/scripts/dev-server.env'
const ASSIGNMENT_SEPARATOR = '='
const SUBAGENT_CHILD_FLAG = '1'
const FAILURE_PREFIX = 'Links were left as written: '

function exportDevServerEnvironment(): void {
	const assignments = readFileSync(
		join(getAgentDir(), DEV_SERVER_ENVIRONMENT),
		'utf8',
	)
	for (const line of assignments.split('\n').filter(Boolean)) {
		const nameLength = line.indexOf(ASSIGNMENT_SEPARATOR)
		if (nameLength <= 0) {
			throw new Error(
				`${DEV_SERVER_ENVIRONMENT} holds one NAME=value per line, not "${line}". Fix that line.`,
			)
		}
		process.env[line.slice(0, nameLength)] ??= line.slice(
			nameLength + ASSIGNMENT_SEPARATOR.length,
		)
	}
}

export default function tailnetLinks(pi: ExtensionAPI): void {
	exportDevServerEnvironment()
	if (process.env.PI_SUBAGENT_CHILD === SUBAGENT_CHILD_FLAG) return
	pi.on('message_end', async (event, ctx) => {
		const { message } = event
		if (message.role !== 'assistant' || message.stopReason !== 'stop') {
			return undefined
		}
		const texts = message.content.flatMap(part =>
			part.type === 'text' ? [part.text] : [],
		)
		if (texts.every(text => !text.trim())) return undefined
		const rewrite = await rewriteTexts(texts, ctx.cwd)
		if (rewrite.kind === 'failed') {
			ctx.ui.notify(FAILURE_PREFIX + rewrite.reason, 'warning')
			return undefined
		}
		for (const note of rewrite.notes) ctx.ui.notify(note, 'warning')
		if (rewrite.texts.join() === texts.join()) return undefined
		const rewritten = [...rewrite.texts]
		const content = message.content.map(part =>
			part.type === 'text'
				? { ...part, text: rewritten.shift() ?? part.text }
				: part,
		)
		return { message: { ...message, content } }
	})
}
