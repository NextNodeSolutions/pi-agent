/** Test pace records each submitted prompt and its origin. tool.ts owns Jev pace decisions and guard receipts. */
import { randomUUID } from 'node:crypto'

import { readRelay } from '#lib/hc-relay.ts'
import { isHumanPrompt, typedPromptText } from '#lib/human-prompt.ts'
import { isSubagentChild } from '#lib/subagent-child.ts'
import { PACE_REQUEST_ENTRY, safePaceText } from '#lib/test-pace/request.ts'

import { registerTestPaceTool } from './tool.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { PaceRequest, RequestOrigin } from '#lib/test-pace/request.ts'

function requestOrigin(typed: string): RequestOrigin {
	if (isSubagentChild()) return { kind: 'delegated' }
	const relay = readRelay(typed)
	return relay ? { kind: 'relay', sender: relay.sender } : { kind: 'human' }
}

export default function testPace(pi: ExtensionAPI): void {
	pi.on('input', event => {
		if (!isHumanPrompt(event)) return
		const typed = typedPromptText(event.text)
		pi.appendEntry(PACE_REQUEST_ENTRY, {
			id: randomUUID(),
			text: safePaceText(typed),
			origin: requestOrigin(typed),
		} satisfies PaceRequest)
	})
	registerTestPaceTool(pi)
}
