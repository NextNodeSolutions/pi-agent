/** Test pace records human requests and path permission. tool.ts owns Jev pace decisions and guard receipts. */
import { randomUUID } from 'node:crypto'

import { isHumanPrompt, typedPromptText } from '#lib/human-prompt.ts'
import { isSubagentChild } from '#lib/subagent-child.ts'
import { targetPaths } from '#lib/test-pace/paths.ts'
import {
	currentPaceRequest,
	PACE_REQUEST_ENTRY,
	safePaceText,
} from '#lib/test-pace/request.ts'

import { registerTestPaceTool } from './tool.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { PaceRequest } from '#lib/test-pace/request.ts'

function registerPermissionCommand(pi: ExtensionAPI): void {
	pi.registerCommand('test-pace', {
		description:
			'Let the agent write tests and test setup under the named files or directories: /test-pace allow <path> [...]. Human command only, valid until the next request.',
		handler: async (args, ctx) => {
			if (!args.startsWith('allow '))
				throw new Error(
					'Use /test-pace allow <file or directory> [...].',
				)
			const paths = await targetPaths(
				ctx.cwd,
				args.slice('allow '.length).trim().split(/\s+/),
				'permission',
			)
			const current = currentPaceRequest(ctx.sessionManager.getBranch())
			pi.appendEntry(PACE_REQUEST_ENTRY, {
				id: current?.id ?? randomUUID(),
				text: current?.text ?? '',
				allowedPaths: [...(current?.allowedPaths ?? []), ...paths],
				delegated: false,
			} satisfies PaceRequest)
			ctx.ui.notify(
				'Test permission recorded for the named paths until the next human request.',
				'info',
			)
			pi.sendMessage(
				{
					customType: 'test-pace-permission',
					content:
						'Continue the current task: the human command authorized test writes under the named paths.',
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
			delegated: isSubagentChild(),
		} satisfies PaceRequest)
	})
	registerPermissionCommand(pi)
	registerTestPaceTool(pi)
}
