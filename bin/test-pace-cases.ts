import { readFileSync } from 'node:fs'

import type { TestPace } from '../extensions/lib/test-pace/decision.ts'

type PaceCase = {
	id: string
	request: string
	intent: string
	expected: TestPace
}

function isPaceCase(candidate: unknown): candidate is PaceCase {
	if (!candidate || typeof candidate !== 'object') return false
	const expected: unknown = Reflect.get(candidate, 'expected')
	return (
		typeof Reflect.get(candidate, 'id') === 'string' &&
		typeof Reflect.get(candidate, 'request') === 'string' &&
		typeof Reflect.get(candidate, 'intent') === 'string' &&
		(expected === 'bug' || expected === 'logic' || expected === 'none')
	)
}

const samples: unknown = JSON.parse(
	readFileSync(new URL('./test-pace-cases.json', import.meta.url), 'utf8'),
)
if (!Array.isArray(samples) || !samples.every(isPaceCase))
	throw new Error('Expected labelled test pace calibration cases.')
export const paceCases: PaceCase[] = samples
