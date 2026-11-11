/**
 * Secret output guard: blocks tool calls that would print cleartext secrets (environment dumps,
 * Infisical reads, credential files) and redacts every known secret value from tool results
 * before they reach the model and the session file. Policy and redaction live in
 * ~/.pi/agent/security so the Claude Code hook shares them.
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { secretAccessRefusal } from '../../../security/secret-policy.ts'
import { redactSecrets } from '../../../security/secret-redact.ts'

import type {
	ExtensionAPI,
	ToolResultEvent,
	ToolResultEventResult,
} from '@earendil-works/pi-coding-agent'

type StructuredContent = Exclude<
	ToolResultEventResult['structuredContent'],
	undefined
>

function redactFullOutputFile(details: unknown): void {
	if (typeof details !== 'object' || details === null) return
	const path = Reflect.get(details, 'fullOutputPath')
	if (typeof path !== 'string') return
	try {
		const text = readFileSync(path, 'utf8')
		const redacted = redactSecrets(text)
		if (redacted !== text) writeFileSync(path, redacted)
	} catch {
		return
	}
}

function redactStructured(
	structuredContent: StructuredContent,
): StructuredContent {
	return JSON.parse(redactSecrets(JSON.stringify(structuredContent)))
}

function redactResult(
	event: ToolResultEvent,
): ToolResultEventResult | undefined {
	redactFullOutputFile(event.details)
	let hasRedaction = false
	const content = event.content.map(part => {
		if (part.type !== 'text') return part
		const text = redactSecrets(part.text)
		if (text === part.text) return part
		hasRedaction = true
		return { ...part, text }
	})
	if (!hasRedaction) return undefined
	const { structuredContent } = event
	if (typeof structuredContent === 'undefined') return { content }
	return { content, structuredContent: redactStructured(structuredContent) }
}

export default function secretOutputGuard(pi: ExtensionAPI): void {
	pi.on('tool_call', event => {
		const reason = secretAccessRefusal(event.toolName, event.input)
		if (!reason) return undefined
		return { block: true, reason }
	})
	pi.on('tool_result', redactResult)
}
