import {
	estimateUsd,
	isJevConfigured,
	JEV_MODEL,
} from '../extensions/lib/jev/client.ts'
import {
	classifyTestPace,
	PACE_CONFIDENCE,
} from '../extensions/lib/test-pace/decision.ts'

import { paceCases } from './test-pace-cases.ts'

if (!isJevConfigured())
	throw new Error('Run with TYPESAFE_API_KEY injected from the core vault.')
const CONCURRENCY = 4
const MEDIAN = 0.5
const P95 = 0.95
const JSON_INDENT = 2
const pending = [...paceCases]
type Measurement = {
	id: string
	expected: string
	actual: string
	raw: string
	confidence: number
	latencyMs: number
	inputTokens: number
}
const measurements: Measurement[] = []

async function measureNext(): Promise<void> {
	const sample = pending.shift()
	if (!sample) return
	const decision = await classifyTestPace({
		request: sample.request,
		intent: sample.intent,
		paths: ['src/feature.test.ts'],
	})
	measurements.push({
		id: sample.id,
		expected: sample.expected,
		actual: decision.pace,
		raw: decision.answer?.choice ?? 'unavailable',
		confidence: decision.answer?.confidence ?? 0,
		latencyMs: decision.answer?.latencyMs ?? 0,
		inputTokens: decision.answer?.inputTokens ?? 0,
	})
	await measureNext()
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => measureNext()))
const mismatches = measurements.filter(
	measurement => measurement.expected !== measurement.actual,
)
for (const mismatch of mismatches)
	process.stdout.write(`${JSON.stringify(mismatch)}\n`)
const latencies = measurements
	.map(measurement => measurement.latencyMs)
	.toSorted((a, b) => a - b)
const inputTokens = measurements.reduce(
	(sum, measurement) => sum + measurement.inputTokens,
	0,
)
const report = {
	model: JEV_MODEL,
	threshold: PACE_CONFIDENCE,
	provenance:
		'Paraphrased short human requests from local Pi sessions, September-November 2026. Client names and product names removed. Agent-labelled expectations and discovered intents, not human-labelled ground truth. No session messages copied verbatim.',
	count: measurements.length,
	labels: Object.fromEntries(
		['bug', 'logic', 'none'].map(label => [
			label,
			measurements.filter(measurement => measurement.expected === label)
				.length,
		]),
	),
	matched: measurements.length - mismatches.length,
	rawMatched: measurements.filter(
		measurement => measurement.expected === measurement.raw,
	).length,
	falseGrants: measurements.filter(
		measurement =>
			measurement.expected === 'none' && measurement.actual !== 'none',
	).length,
	unavailable: measurements.filter(
		measurement => measurement.raw === 'unavailable',
	).length,
	medianMs: latencies[Math.floor(latencies.length * MEDIAN)],
	p95Ms: latencies[Math.floor(latencies.length * P95)],
	maxMs: latencies.at(-1),
	inputTokens,
	inputUsd: estimateUsd(inputTokens),
}
process.stdout.write(`${JSON.stringify(report, null, JSON_INDENT)}\n`)
if (report.falseGrants || report.unavailable) process.exitCode = 1
