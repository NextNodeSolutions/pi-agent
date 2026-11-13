/** Test pace records each submitted prompt and its origin. tool.ts owns Jev pace decisions and guard receipts. */
import { randomUUID } from 'node:crypto'

import { isHumanPrompt, typedPromptText } from '#lib/human-prompt.ts'
import { isSubagentChild } from '#lib/subagent-child.ts'
import { safePaceText } from '#lib/test-pace/pace-text.ts'
import { PACE_REQUEST_ENTRY, typedOrigin } from '#lib/test-pace/request.ts'

import { registerTestPaceTool } from './tool.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { PaceRequest } from '#lib/test-pace/request.ts'

export default function testPace(pi: ExtensionAPI): void {
	pi.on('input', event => {
		if (!isHumanPrompt(event)) return
		const typed = typedPromptText(event.text)
		pi.appendEntry(PACE_REQUEST_ENTRY, {
			id: randomUUID(),
			text: safePaceText(typed),
			origin: isSubagentChild()
				? { kind: 'delegated' }
				: typedOrigin(typed),
		} satisfies PaceRequest)
	})
	registerTestPaceTool(pi)
}
