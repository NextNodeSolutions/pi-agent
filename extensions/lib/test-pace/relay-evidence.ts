import { readFile } from 'node:fs/promises'

import { ownTerminal, senderSessionFile } from '#lib/hc-relay.ts'

import { parseEntries, sessionBranch, sessionRecords } from './evidence.ts'

import type { Evidence } from './consent.ts'
import type { Relay } from './evidence.ts'

/** Shorter replies ("ok", "oui") are too common to prove which answer a relay quotes. */
const MIN_QUOTE_CHARS = 12
const NOT_ALPHANUMERIC = /[^A-Za-z0-9]+/u

function normalized(text: string): string {
	return text.replace(/\s+/gu, ' ').trim().toLowerCase()
}

/** `t157` is named by `t157_test_moves` and `t157:`, not by `t1570`. */
function namesTerminal(text: string, address: string): boolean {
	return text.split(NOT_ALPHANUMERIC).includes(address)
}

function isBound(
	evidence: Evidence,
	address: string,
	relayed: string,
): boolean {
	const reply = normalized(evidence.reply)
	return (
		namesTerminal(`${evidence.question}\n${evidence.reply}`, address) ||
		(reply.length >= MIN_QUOTE_CHARS && relayed.includes(reply))
	)
}

async function senderEvidence(
	sender: string,
	relays: readonly Relay[],
	address: string,
): Promise<Evidence[]> {
	const file = await senderSessionFile(sender)
	if (!file) return []
	const content = await readFile(file, 'utf8').catch(() => '')
	const cutoff =
		relays
			.map(relay => relay.at)
			.toSorted()
			.at(-1) ?? ''
	const relayed = normalized(relays.map(relay => relay.text).join('\n'))
	return sessionRecords(sessionBranch(parseEntries(content)))
		.evidence.filter(evidence => evidence.at <= cutoff)
		.map(evidence =>
			prefixedEvidence(
				file,
				evidence,
				isBound(evidence, address, relayed) ? 'bound' : 'withdrawal',
			),
		)
}

function prefixedEvidence(
	file: string,
	{ id, at, question, reply }: Evidence,
	binding: 'bound' | 'withdrawal',
): Evidence {
	return {
		id: `${file}#${binding}#${id}`,
		mayGrant: binding === 'bound',
		at,
		question,
		reply,
	}
}

/**
 * A relay grants nothing by its own text: it points at the sender's Pi session,
 * whose human answers count when they name this terminal or the relay quotes them,
 * and were given before the sender's latest relay here.
 */
export async function relayedEvidence(
	relays: readonly Relay[],
): Promise<Evidence[]> {
	const address = ownTerminal()
	if (!address) return []
	const senders = [...new Set(relays.map(relay => relay.sender))]
	const evidence = await Promise.all(
		senders.map(sender =>
			senderEvidence(
				sender,
				relays.filter(relay => relay.sender === sender),
				address,
			),
		),
	)
	return evidence.flat()
}
