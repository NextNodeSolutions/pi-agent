import { readFile } from 'node:fs/promises'

import {
	ownTerminal,
	SESSION_LABEL,
	terminalLabel,
	TITLE_LABEL,
} from '#lib/hc-relay.ts'

import { parseEntries, sessionBranch, sessionRecords } from './evidence.ts'

import type { Evidence, Relay } from './evidence.ts'

/** Shorter replies ("ok", "oui") and titles are too common to prove which answer or thread a relay means. */
const MIN_DISTINCT_CHARS = 12
const NOT_ALPHANUMERIC = /[^A-Za-z0-9]+/u

function normalized(text: string): string {
	return text.replace(/\s+/gu, ' ').trim().toLowerCase()
}

/** Whole words, so `t157` is named by `t157_test_moves` and `t157:`, not by `t1570`. */
function words(text: string): string {
	return ` ${text.toLowerCase().split(NOT_ALPHANUMERIC).filter(Boolean).join(' ')} `
}

async function receiverNames(address: string): Promise<string[]> {
	const title = (await terminalLabel(address, TITLE_LABEL)) ?? ''
	return [address, title.length >= MIN_DISTINCT_CHARS ? title : '']
		.map(words)
		.filter(name => name.trim())
}

function isBound(
	evidence: Evidence,
	receivers: readonly string[],
	relayed: string,
): boolean {
	const exchange = words(`${evidence.question}\n${evidence.reply}`)
	const reply = normalized(evidence.reply)
	return (
		receivers.some(name => exchange.includes(name)) ||
		(reply.length >= MIN_DISTINCT_CHARS && relayed.includes(reply))
	)
}

async function senderEvidence(
	sender: string,
	relays: readonly Relay[],
	receivers: readonly string[],
): Promise<Evidence[]> {
	const file = await terminalLabel(sender, SESSION_LABEL)
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
		.map(evidence => {
			const mayGrant = isBound(evidence, receivers, relayed)
			const binding = mayGrant ? 'bound' : 'withdrawal'
			const { id, at, question, reply } = evidence
			return {
				id: `${file}#${binding}#${id}`,
				mayGrant,
				at,
				question,
				reply,
			}
		})
}

/** A relay grants nothing by its own text: only the human answers in the sender's Pi session can. */
export async function relayedEvidence(
	relays: readonly Relay[],
): Promise<Evidence[]> {
	const address = ownTerminal()
	if (!address || !relays.length) return []
	const receivers = await receiverNames(address)
	const senders = [...new Set(relays.map(relay => relay.sender))]
	const evidence = await Promise.all(
		senders.map(sender =>
			senderEvidence(
				sender,
				relays.filter(relay => relay.sender === sender),
				receivers,
			),
		),
	)
	return evidence.flat()
}
