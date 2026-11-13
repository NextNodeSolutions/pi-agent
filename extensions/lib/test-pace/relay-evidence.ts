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

type Receiver = { names: string[]; thread: string }

async function receiverOf(address: string): Promise<Receiver> {
	const title = (await terminalLabel(address, TITLE_LABEL)) ?? ''
	return {
		names: [address, title.length >= MIN_DISTINCT_CHARS ? title : '']
			.map(words)
			.filter(name => name.trim()),
		thread: title ? `${address} "${title}"` : address,
	}
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

type SenderContext = {
	file: string
	cutoff: string
	relayed: string
	receiver: Receiver
}

function readHere(evidence: Evidence, sender: SenderContext): Evidence {
	const { file, cutoff, relayed, receiver } = sender
	if (!isBound(evidence, receiver.names, relayed))
		return {
			...evidence,
			id: `${file}#other#${evidence.id}`,
			mayGrant: false,
			receiver: receiver.thread,
		}
	const mayGrant = evidence.at <= cutoff
	const binding = mayGrant ? 'bound' : 'late'
	return { ...evidence, id: `${file}#${binding}#${evidence.id}`, mayGrant }
}

async function senderEvidence(
	sender: string,
	relays: readonly Relay[],
	receiver: Receiver,
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
	const context = { file, cutoff, relayed, receiver }
	return sessionRecords(sessionBranch(parseEntries(content))).evidence.map(
		evidence => readHere(evidence, context),
	)
}

/** A relay carries no consent: the sender's human exchanges grant when they name this terminal or a relay quotes them, up to the sender's latest relay here; its stops count until now, and an unnamed one is judged against this thread (`stop-target.ts`). */
export async function relayedEvidence(
	relays: readonly Relay[],
): Promise<Evidence[]> {
	const address = ownTerminal()
	if (!address || !relays.length) return []
	const receiver = await receiverOf(address)
	const senders = [...new Set(relays.map(relay => relay.sender))]
	const evidence = await Promise.all(
		senders.map(sender =>
			senderEvidence(
				sender,
				relays.filter(relay => relay.sender === sender),
				receiver,
			),
		),
	)
	return evidence.flat()
}
