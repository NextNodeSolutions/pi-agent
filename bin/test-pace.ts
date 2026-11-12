import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { classifyTestPace } from '../extensions/lib/test-pace/decision.ts'
import {
	ineligibleTarget,
	targetPaths,
} from '../extensions/lib/test-pace/paths.ts'
import { classifyTestPermission } from '../extensions/lib/test-pace/permission.ts'
import { physicalPath } from '../extensions/lib/test-pace/physical-path.ts'
import {
	PACE_REQUEST_ENTRY,
	readPaceRequest,
	safePaceText,
} from '../extensions/lib/test-pace/request.ts'

import type { PaceDecision } from '../extensions/lib/test-pace/decision.ts'

const HARNESS_TEXT =
	/^\s*<(?:command-(?:name|message|args)|local-command-|task-notification|system-reminder)/

function parsedEntry(line: string): object {
	try {
		return Object(JSON.parse(line))
	} catch {
		return {}
	}
}

function typedText(entry: object): string {
	if (Reflect.get(entry, 'isMeta') || Reflect.get(entry, 'isCompactSummary'))
		return ''
	if (Reflect.get(entry, 'type') !== 'user') return ''
	const content: unknown = Reflect.get(
		Object(Reflect.get(entry, 'message')),
		'content',
	)
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	if (content.some(part => Reflect.get(Object(part), 'type') === 'tool_result'))
		return ''
	return content
		.map(part => Reflect.get(Object(part), 'text'))
		.filter(text => typeof text === 'string')
		.join('\n')
}

function humanRequest(entry: object): string {
	if (
		Reflect.get(entry, 'type') === 'custom' &&
		Reflect.get(entry, 'customType') === PACE_REQUEST_ENTRY
	)
		return readPaceRequest(Reflect.get(entry, 'data'))?.text ?? ''
	const text = typedText(entry)
	return HARNESS_TEXT.test(text) ? '' : text
}

function lastHumanRequest(transcript: string): string {
	return (
		transcript
			.trim()
			.split('\n')
			.toReversed()
			.map(line => humanRequest(parsedEntry(line)))
			.find(Boolean) ?? ''
	)
}

async function paceFor(
	request: string,
	intent: string,
	paths: string[],
): Promise<PaceDecision> {
	const root = await physicalPath(process.cwd())
	const reasons = await Promise.all(
		paths.map(path => ineligibleTarget(root, path)),
	)
	const reason = reasons.find(Boolean)
	if (reason) return { pace: 'none', reason }
	if (!request)
		return {
			pace: 'none',
			reason: 'No human request found in the session transcript.',
		}
	return classifyTestPace({ request, intent: safePaceText(intent), paths })
}

const { values, positionals } = parseArgs({
	options: { session: { type: 'string' }, intent: { type: 'string' } },
	allowPositionals: true,
})
if (!values.session || !values.intent || !positionals.length) {
	throw new Error(
		'Usage: node --experimental-transform-types bin/test-pace.ts --session <Pi or Claude JSONL transcript> --intent <named bug or requirement> <test paths...>',
	)
}
const paths = await targetPaths(process.cwd(), positionals)
const request = safePaceText(
	lastHumanRequest(readFileSync(values.session, 'utf8')),
)
const [decision, permission] = await Promise.all([
	paceFor(request, values.intent, paths),
	classifyTestPermission(request),
])
process.stdout.write(
	`${JSON.stringify({ ...decision, permission: permission.permission, paths })}\n`,
)
