import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sessionRecords } from '#lib/test-pace/evidence.ts'
import { PACE_REQUEST_ENTRY } from '#lib/test-pace/request.ts'

import { transcriptRecords } from '../bin/test-pace-transcript.ts'

import type { SessionRecords } from '#lib/test-pace/evidence.ts'

const PROPOSAL = 'May I delete tests/legacy/?'
const REFUSAL = 'no, first fix the build'

function piRequest(id: string, text: string): object {
	return {
		type: 'custom',
		customType: PACE_REQUEST_ENTRY,
		timestamp: `2026-11-13T10:0${id}:00Z`,
		data: { id, text, origin: { kind: 'human' } },
	}
}

function piAssistant(content: object[]): object {
	return { type: 'message', message: { role: 'assistant', content } }
}

function pairs(records: SessionRecords): string[][] {
	return records.evidence.map(({ reply, question }) => [reply, question])
}

test('a Pi prompt after a refused proposal is not paired with that proposal', () => {
	const records = sessionRecords([
		piAssistant([{ type: 'text', text: PROPOSAL }]),
		piRequest('1', REFUSAL),
		piAssistant([
			{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} },
		]),
		piRequest('2', 'go'),
	])
	assert.deepEqual(pairs(records), [
		[REFUSAL, PROPOSAL],
		['go', ''],
	])
})

test('a Claude Code prompt after a refused proposal is not paired with that proposal', () => {
	const records = transcriptRecords([
		{
			type: 'assistant',
			uuid: 'a1',
			message: { content: [{ type: 'text', text: PROPOSAL }] },
		},
		{ type: 'user', uuid: 'u1', message: { content: REFUSAL } },
		{
			type: 'assistant',
			uuid: 'a2',
			message: {
				content: [
					{ type: 'tool_use', id: 'x', name: 'Bash', input: {} },
				],
			},
		},
		{ type: 'user', uuid: 'u2', message: { content: 'go' } },
	])
	assert.deepEqual(pairs(records), [
		[REFUSAL, PROPOSAL],
		['go', ''],
	])
})
