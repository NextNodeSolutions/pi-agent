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

import { isSubagentChild } from '#lib/subagent-child.ts'

import { rewriteTexts } from './rewrite.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const DEV_SERVER_ENVIRONMENT = 'skills/tailnet-links/scripts/dev-server.env'
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(\S*)$/
const LINE_BREAK = /\r?\n/
const FAILURE_PREFIX = 'Links were left as written: '

function exportDevServerEnvironment(): void {
	const assignments = readFileSync(
		join(getAgentDir(), DEV_SERVER_ENVIRONMENT),
		'utf8',
	)
	for (const line of assignments.split(LINE_BREAK).filter(Boolean)) {
		const [, name, value] = ASSIGNMENT.exec(line) ?? []
		if (!name) {
			throw new Error(
				`${DEV_SERVER_ENVIRONMENT} holds one NAME=value per line, with no space and no comment, not "${line}". Fix that line.`,
			)
		}
		process.env[name] ??= value
	}
}

export default function tailnetLinks(pi: ExtensionAPI): void {
	exportDevServerEnvironment()
	if (isSubagentChild()) return
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
