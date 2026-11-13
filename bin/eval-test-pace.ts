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
	classifyOperation,
	OPERATION_CONFIDENCE,
	OPERATION_OUTCOMES,
} from '../extensions/lib/test-pace/operation.ts'
import {
	classifyConsent,
	PERMISSION_CONFIDENCE,
} from '../extensions/lib/test-pace/permission.ts'
import { forbidsTestAuthoring } from '../extensions/lib/test-pace/request.ts'
import {
	classifyScopePath,
	SCOPE_PATH_CONFIDENCE,
	SCOPE_PATH_ROLES,
} from '../extensions/lib/test-pace/scope-path.ts'
import {
	classifyStopTarget,
	STOP_TARGET_CONFIDENCE,
	STOP_TARGETS,
} from '../extensions/lib/test-pace/stop-target.ts'

import {
	operationCases,
	paceCases,
	permissionCases,
	scopePathCases,
	stopTargetCases,
} from './test-pace-cases.ts'

import type { ChoiceResult } from '../extensions/lib/jev/client.ts'
import type { ConsentVerdict } from '../extensions/lib/test-pace/permission.ts'

if (!isJevConfigured())
	throw new Error('Run with TYPESAFE_API_KEY injected from the core vault.')
const CONCURRENCY = 4
const MEDIAN = 0.5
const P95 = 0.95
const JSON_INDENT = 2
/** A missed withdrawal keeps earlier consent alive, so it ranks below none. */
const PERMISSION_RANK: readonly string[] = [
	'withdraw',
	'none',
	'new',
	'existing',
] satisfies readonly ConsentVerdict[]

type Sample = { id: string; request: string; expected: string }
/** `vetoed`: the classifier refused without asking Jev. */
type Verdict = {
	actual: string
	answer: ChoiceResult | undefined
	vetoed?: boolean
}
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
		const { actual, answer, vetoed } = await calibration.classify(sample)
		measurements.push({
			id: sample.id,
			expected: sample.expected,
			actual,
			raw: answer?.choice ?? (vetoed ? 'vetoed' : 'unavailable'),
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
			'Pace cases: paraphrased short human requests from local Pi sessions, September-November 2026, client and product names removed. Permission cases: written for this calibration in the phrasing those sessions use, some as a human reply to an agent question; the consent shapes of November 2026 paraphrase the refused live case. Agent-labelled expectations, not human-labelled ground truth. No session message copied verbatim except the human sentence of case c006, quoted in the request for this change. Stop-target cases: written for this calibration around the unnamed stop and the docs pull request examples the coordinator gave in November 2026. Scope-path cases: written for this calibration around the exchanges of the November 2026 live proof and code review where a path named as context became scope.',
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
		return {
			actual: decision.pace,
			answer: decision.answer,
			vetoed: forbidsTestAuthoring(sample.request),
		}
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
		const decision = await classifyConsent({
			question: sample.question,
			reply: sample.request,
		})
		return { actual: decision.verdict, answer: decision.answer }
	},
	grantsTooMuch: (expected, actual) =>
		PERMISSION_RANK.indexOf(actual) > PERMISSION_RANK.indexOf(expected),
})
const operation = await calibrate({
	name: 'operation',
	threshold: OPERATION_CONFIDENCE,
	labels: OPERATION_OUTCOMES,
	cases: operationCases,
	classify: async sample => {
		const decision = await classifyOperation({ question: sample.question, reply: sample.request }, sample.operation)
		return { actual: decision.allowed ? 'allowed' : 'refused', answer: decision.answer }
	},
	grantsTooMuch: (expected, actual) => expected === 'refused' && actual === 'allowed',
})
const stopTarget = await calibrate({
	name: 'stop-target',
	threshold: STOP_TARGET_CONFIDENCE,
	labels: STOP_TARGETS,
	cases: stopTargetCases,
	classify: async sample => {
		const decision = await classifyStopTarget(
			{ question: sample.question, reply: sample.request },
			sample.thread,
		)
		return { actual: decision.target, answer: decision.answer }
	},
	grantsTooMuch: (expected, actual) =>
		expected === 'here' && actual === 'elsewhere',
})
const scopePath = await calibrate({
	name: 'scope-path',
	threshold: SCOPE_PATH_CONFIDENCE,
	labels: SCOPE_PATH_ROLES,
	cases: scopePathCases,
	classify: async sample => {
		const decision = await classifyScopePath(
			{ question: sample.question, reply: sample.request },
			sample.path,
		)
		return {
			actual: decision.isCovered ? 'covered' : 'context',
			answer: decision.answer,
		}
	},
	grantsTooMuch: (expected, actual) =>
		expected === 'context' && actual === 'covered',
})
if (!pace || !permission || !operation || !stopTarget || !scopePath)
	process.exitCode = 1
