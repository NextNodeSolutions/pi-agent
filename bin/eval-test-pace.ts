import {
	estimateUsd,
	isJevConfigured,
	JEV_MODEL,
} from '../extensions/lib/jev/client.ts'
import {
	classifyTestPace,
	PACE_CONFIDENCE,
} from '../extensions/lib/test-pace/decision.ts'
import {
	classifyTestPermission,
	PERMISSION_CONFIDENCE,
} from '../extensions/lib/test-pace/permission.ts'

import { forbidsTestAuthoring } from '../extensions/lib/test-pace/request.ts'

import { paceCases, permissionCases } from './test-pace-cases.ts'

import type { ChoiceResult } from '../extensions/lib/jev/client.ts'

if (!isJevConfigured())
	throw new Error('Run with TYPESAFE_API_KEY injected from the core vault.')
const CONCURRENCY = 4
const MEDIAN = 0.5
const P95 = 0.95
const JSON_INDENT = 2
const PERMISSION_RANK = ['none', 'new', 'existing']

type Sample = { id: string; request: string; expected: string }
type Verdict = { actual: string; answer: ChoiceResult | undefined }
type Measurement = Omit<Sample, 'request'> & {
	actual: string
	raw: string
	confidence: number
	latencyMs: number
	inputTokens: number
}
type Calibration<Case extends Sample> = {
	name: string
	threshold: number
	labels: readonly string[]
	cases: readonly Case[]
	classify: (sample: Case) => Promise<Verdict>
	grantsTooMuch: (expected: string, actual: string) => boolean
}

async function measure<Case extends Sample>(
	calibration: Calibration<Case>,
): Promise<Measurement[]> {
	const pending = [...calibration.cases]
	const measurements: Measurement[] = []
	async function measureNext(): Promise<void> {
		const sample = pending.shift()
		if (!sample) return
		const { actual, answer } = await calibration.classify(sample)
		measurements.push({
			id: sample.id,
			expected: sample.expected,
			actual,
			raw:
				answer?.choice ??
				(forbidsTestAuthoring(sample.request) ? 'vetoed' : 'unavailable'),
			confidence: answer?.confidence ?? 0,
			latencyMs: answer?.latencyMs ?? 0,
			inputTokens: answer?.inputTokens ?? 0,
		})
		await measureNext()
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, () => measureNext()))
	return measurements
}

async function calibrate<Case extends Sample>(
	calibration: Calibration<Case>,
): Promise<boolean> {
	const measurements = await measure(calibration)
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
		decision: calibration.name,
		model: JEV_MODEL,
		threshold: calibration.threshold,
		count: measurements.length,
		labels: Object.fromEntries(
			calibration.labels.map(label => [
				label,
				measurements.filter(
					measurement => measurement.expected === label,
				).length,
			]),
		),
		matched: measurements.length - mismatches.length,
		rawMatched: measurements.filter(
			measurement => measurement.expected === measurement.raw,
		).length,
		falseGrants: measurements.filter(measurement =>
			calibration.grantsTooMuch(measurement.expected, measurement.actual),
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
	return report.falseGrants === 0 && report.unavailable === 0
}

process.stdout.write(
	`${JSON.stringify({
		provenance:
			'Pace cases: paraphrased short human requests from local Pi sessions, September-November 2026, client and product names removed. Permission cases: written for this calibration in the phrasing those sessions use. Agent-labelled expectations, not human-labelled ground truth. No session message copied verbatim.',
	})}\n`,
)
const pace = await calibrate({
	name: 'pace',
	threshold: PACE_CONFIDENCE,
	labels: ['bug', 'logic', 'none'],
	cases: paceCases,
	classify: async sample => {
		const decision = await classifyTestPace({
			request: sample.request,
			intent: sample.intent,
			paths: ['src/feature.test.ts'],
		})
		return { actual: decision.pace, answer: decision.answer }
	},
	grantsTooMuch: (expected, actual) =>
		expected === 'none' && actual !== 'none',
})
const permission = await calibrate({
	name: 'permission',
	threshold: PERMISSION_CONFIDENCE,
	labels: PERMISSION_RANK,
	cases: permissionCases,
	classify: async sample => {
		const decision = await classifyTestPermission(sample.request)
		return { actual: decision.permission, answer: decision.answer }
	},
	grantsTooMuch: (expected, actual) =>
		PERMISSION_RANK.indexOf(actual) > PERMISSION_RANK.indexOf(expected),
})
if (!pace || !permission) process.exitCode = 1
