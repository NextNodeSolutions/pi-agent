import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import {
	activeConsents,
	consentKind,
	judgeAll,
	judgeEvidence,
} from '../extensions/lib/test-pace/consent.ts'
import { classifyTestPace } from '../extensions/lib/test-pace/decision.ts'
import { parseEntries } from '../extensions/lib/test-pace/evidence.ts'
import {
	ineligibleTarget,
	targetPaths,
} from '../extensions/lib/test-pace/paths.ts'
import { physicalPath } from '../extensions/lib/test-pace/physical-path.ts'
import { permitsOperation } from '../extensions/lib/test-pace/operation.ts'
import { relayedEvidence } from '../extensions/lib/test-pace/relay-evidence.ts'
import { safePaceText } from '../extensions/lib/test-pace/request.ts'

import { lastHumanRequest, transcriptRecords } from './test-pace-transcript.ts'

import type {
	ConsentKind,
	Judgment,
} from '../extensions/lib/test-pace/consent.ts'
import type { PaceDecision } from '../extensions/lib/test-pace/decision.ts'

const WEAKEST_FIRST: readonly ConsentKind[] = ['none', 'new', 'existing']

async function paceFor(
	root: string,
	request: string,
	intent: string,
	paths: string[],
): Promise<PaceDecision> {
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

async function consentsFor(
	root: string,
	entries: readonly object[],
): Promise<Judgment[]> {
	const records = transcriptRecords(entries)
	const relayed = await relayedEvidence(
		records.relays,
		process.env.HC_TERMINAL_ID,
	)
	const judged = await judgeAll([...records.evidence, ...relayed], evidence =>
		judgeEvidence(root, evidence),
	)
	return activeConsents(judged.map(({ judgment }) => judgment))
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
const root = await physicalPath(process.cwd())
const paths = await targetPaths(process.cwd(), positionals)
const entries = parseEntries(readFileSync(values.session, 'utf8'))
const request = safePaceText(lastHumanRequest(entries))
const [decision, consents] = await Promise.all([
	paceFor(root, request, values.intent, paths),
	consentsFor(root, entries),
])
const applicable = (await Promise.all(consents.map(async consent =>
	(await permitsOperation(consent, values.intent ?? '')) ? [consent] : [],
))).flat()
const kinds = paths.map(path => consentKind(applicable, path))
const permission = WEAKEST_FIRST.find(kind => kinds.includes(kind)) ?? 'none'
process.stdout.write(
	`${JSON.stringify({ ...decision, permission, paths })}\n`,
)
