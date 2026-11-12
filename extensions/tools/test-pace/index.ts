/** Test pace records human requests and exact-path permission. tool.ts owns Jev decisions and guard receipts. */
import { randomUUID } from 'node:crypto'

import { isHumanPrompt, typedPromptText } from '#lib/human-prompt.ts'
import { targetPaths } from '#lib/test-pace/paths.ts'
import { PACE_REQUEST_ENTRY, safePaceText } from '#lib/test-pace/request.ts'

import { registerTestPaceTool } from './tool.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { PaceRequest } from '#lib/test-pace/request.ts'

function registerPermissionCommand(pi: ExtensionAPI): void {
	pi.registerCommand('test-pace', {
		description:
			'Authorize exact test or setup paths for this request: /test-pace allow <path> [...]. Human command only, scoped until the next request.',
		handler: async (args, ctx) => {
			if (!args.startsWith('allow '))
				throw new Error('Use /test-pace allow <exact path> [...].')
			const paths = await targetPaths(
				ctx.cwd,
				args.slice('allow '.length).trim().split(/\s+/),
				'permission',
			)
			pi.appendEntry(PACE_REQUEST_ENTRY, {
				id: randomUUID(),
				text: args,
				allowedPaths: paths,
			} satisfies PaceRequest)
			ctx.ui.notify(
				'Test permission recorded for the named paths until the next human request.',
				'info',
			)
			pi.sendMessage(
				{
					customType: 'test-pace-permission',
					content:
						'Continue the current task with the exact test paths explicitly authorized by the human command.',
					display: true,
				},
				{ triggerTurn: true },
			)
		},
	})
}

export default function testPace(pi: ExtensionAPI): void {
	pi.on('input', event => {
		if (!isHumanPrompt(event)) return
		pi.appendEntry(PACE_REQUEST_ENTRY, {
			id: randomUUID(),
			text: safePaceText(typedPromptText(event.text)),
			allowedPaths: [],
		} satisfies PaceRequest)
	})
	registerPermissionCommand(pi)
	registerTestPaceTool(pi)
}
