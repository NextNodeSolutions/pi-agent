import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { classifyTestPace } from '../extensions/lib/test-pace/decision.ts'
import {
	ineligibleTarget,
	targetPaths,
} from '../extensions/lib/test-pace/paths.ts'
import {
	PACE_REQUEST_ENTRY,
	readPaceRequest,
	safePaceText,
} from '../extensions/lib/test-pace/request.ts'

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
const reasons = await Promise.all(paths.map(path => ineligibleTarget(path)))
const reason = reasons.find(Boolean)
if (reason) {
	process.stdout.write(`${JSON.stringify({ pace: 'none', reason })}\n`)
} else {
	const transcript = await readFile(values.session, 'utf8')
	const request = lastHumanRequest(transcript)
	const decision = request
		? await classifyTestPace({
				request: safePaceText(request),
				intent: safePaceText(values.intent),
				paths,
			})
		: {
				pace: 'none',
				reason: 'No human request found in the session transcript.',
			}
	process.stdout.write(`${JSON.stringify({ ...decision, paths })}\n`)
}

function lastHumanRequest(transcript: string): string {
	for (const line of transcript.trim().split('\n').toReversed()) {
		let entry: unknown
		try {
			entry = JSON.parse(line)
		} catch {
			return ''
		}
		if (
			Reflect.get(Object(entry), 'isMeta') === true ||
			Reflect.get(Object(entry), 'isCompactSummary') === true
		)
			continue
		if (
			Reflect.get(Object(entry), 'type') === 'custom' &&
			Reflect.get(Object(entry), 'customType') === PACE_REQUEST_ENTRY
		)
			return (
				readPaceRequest(Reflect.get(Object(entry), 'data'))?.text ?? ''
			)
		if (Reflect.get(Object(entry), 'type') !== 'user') continue
		const message: unknown = Reflect.get(Object(entry), 'message')
		const content: unknown = Reflect.get(Object(message), 'content')
		if (typeof content === 'string') return content
		if (
			Array.isArray(content) &&
			content.every(part => Reflect.get(Object(part), 'type') === 'text')
		)
			return content
				.map(part => Reflect.get(Object(part), 'text'))
				.join('\n')
	}
	return ''
}
