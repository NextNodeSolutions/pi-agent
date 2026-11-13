import { execFile } from 'node:child_process'
import { chmodSync, copyFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { errorText } from '#lib/error-text.ts'
import { MAGPIE_PROVIDER } from '#lib/magpie.ts'

import { readCheckedJson } from './checked-json.ts'

import type { Static } from 'typebox'
import type { RoutingRule, RoutingSpec } from './spec.ts'

const PROVIDERS_PATH = join(homedir(), '.config', 'magpie', 'providers.json')
/** providers.json holds provider keys: its backup stays owner-only. */
const BACKUP_MODE = 0o600
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
const FIRST_RULE = '1'
const runFile = promisify(execFile)

const ModelsFileSchema = Type.Object({
	providers: Type.Object({
		[MAGPIE_PROVIDER]: Type.Object({ baseUrl: Type.String() }),
	}),
})
const ProvidersFileSchema = Type.Object({
	groups: Type.Array(Type.Object({ id: Type.String() })),
})
const StoredRuleSchema = Type.Object({
	use: Type.Optional(Type.String()),
	more: Type.Optional(Type.Array(Type.String())),
	intent: Type.Optional(Type.String()),
	folders: Type.Optional(Type.Array(Type.String())),
})
const StoredGroupSchema = Type.Object({
	members: Type.Array(Type.String()),
	classifier: Type.Optional(Type.String()),
	intentSure: Type.Optional(Type.Number()),
	rules: Type.Optional(Type.Array(StoredRuleSchema)),
})

type StoredRule = Static<typeof StoredRuleSchema>
type StoredGroup = Static<typeof StoredGroupSchema>
type RuleShape = {
	use: string
	more: string[]
	intent: string
	folders: string[]
}
type Comparison = { name: string; stored: string; expected: string }
export type ApplyReport = { added: number; replaced: number; backup: string }

function firstLabel(host: string): string {
	return host.split('.')[0]?.toLowerCase() ?? ''
}

/** Rules written into another machine's Magpie route nothing: models.json names the one pi calls. */
function assertMagpieHost(agentDir: string): void {
	const models = readCheckedJson(
		join(agentDir, 'models.json'),
		ModelsFileSchema,
	)
	const host = new URL(models.providers[MAGPIE_PROVIDER].baseUrl).hostname
	if (LOCAL_HOSTS.has(host) || firstLabel(host) === firstLabel(hostname()))
		return
	throw new Error(
		`Magpie runs on ${host}, this machine is ${hostname()}: apply there`,
	)
}

function storedGroup(id: string): StoredGroup {
	const { groups } = readCheckedJson(PROVIDERS_PATH, ProvidersFileSchema)
	const group = groups.find(candidate => candidate.id === id)
	if (!Value.Check(StoredGroupSchema, group))
		throw new Error(`${PROVIDERS_PATH} has no usable group ${id}`)
	return group
}

function storedShape(rule: StoredRule): RuleShape {
	return {
		use: rule.use ?? '',
		more: rule.more ?? [],
		intent: rule.intent ?? '',
		folders: rule.folders ?? [],
	}
}

function expectedShape(spec: RoutingSpec, rule: RoutingRule): RuleShape {
	const [use = '', ...more] = rule.use
	return {
		use,
		more,
		intent: rule.intent ? (spec.intents[rule.intent] ?? '') : '',
		folders: rule.scope ? (spec.scopes[rule.scope] ?? []) : [],
	}
}

function ruleArguments(spec: RoutingSpec, rule: RoutingRule): string[] {
	const shape = expectedShape(spec, rule)
	return [
		'group',
		'rule',
		'add',
		spec.group,
		`use=${rule.use.join(',')}`,
		...(shape.intent ? [`intent=${shape.intent}`] : []),
		...(shape.folders.length ? [`folders=${shape.folders.join(',')}`] : []),
	]
}

/** Magpie stores a classifier only alongside an intent rule, so the first one carries it. */
function addCommands(spec: RoutingSpec): string[][] {
	const firstIntent = spec.rules.findIndex(rule => rule.intent)
	return spec.rules.map((rule, index) => [
		...ruleArguments(spec, rule),
		...(index === firstIntent ? [`classifier=${spec.classifier}`] : []),
	])
}

async function runInOrder(commands: string[][]): Promise<void> {
	await commands.reduce<Promise<unknown>>(
		(previous, command) => previous.then(() => runFile('magpie', command)),
		Promise.resolve(),
	)
}

function comparisons(spec: RoutingSpec, group: StoredGroup): Comparison[] {
	const storedRules = (group.rules ?? []).map(rule =>
		JSON.stringify(storedShape(rule)),
	)
	const rules = spec.rules.map((rule, index) => ({
		name: `rule ${index + 1}`,
		stored: storedRules[index] ?? 'nothing',
		expected: JSON.stringify(expectedShape(spec, rule)),
	}))
	return [
		{
			name: 'members',
			stored: group.members.join(','),
			expected: spec.members.join(','),
		},
		{
			name: 'classifier',
			stored: group.classifier ?? 'none',
			expected: spec.classifier,
		},
		{
			name: 'intentSure',
			stored: String(group.intentSure),
			expected: String(spec.intentSure),
		},
		{
			name: 'rule count',
			stored: String(storedRules.length),
			expected: String(rules.length),
		},
		...rules,
	]
}

function mismatches(spec: RoutingSpec, group: StoredGroup): string[] {
	return comparisons(spec, group)
		.filter(({ stored, expected }) => stored !== expected)
		.map(
			({ name, stored, expected }) =>
				`${name}: stored ${stored}, expected ${expected}`,
		)
}

/** New rules go in behind the old ones, which leave only then: the router never runs without rules. */
async function rewriteRules(
	spec: RoutingSpec,
	replaced: number,
): Promise<void> {
	await runInOrder([
		[
			'group',
			'set',
			spec.group,
			`models=${spec.members.join(',')}`,
			`intent-sure=${spec.intentSure}`,
		],
		...addCommands(spec),
		...Array.from({ length: replaced }, () => [
			'group',
			'rule',
			'rm',
			spec.group,
			FIRST_RULE,
		]),
	])
	const problems = mismatches(spec, storedGroup(spec.group))
	if (problems.length)
		throw new Error(
			`Magpie disagrees with the spec: ${problems.join('; ')}`,
		)
}

function backUpProviders(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const backup = `${PROVIDERS_PATH}.bak-route-${stamp}`
	copyFileSync(PROVIDERS_PATH, backup)
	chmodSync(backup, BACKUP_MODE)
	return backup
}

export async function applyRoutingSpec(
	spec: RoutingSpec,
	agentDir: string,
): Promise<ApplyReport> {
	assertMagpieHost(agentDir)
	const replaced = storedGroup(spec.group).rules?.length ?? 0
	const backup = backUpProviders()
	try {
		await rewriteRules(spec, replaced)
	} catch (error) {
		throw new Error(`${errorText(error)} (backup: ${backup})`, {
			cause: error,
		})
	}
	return { added: spec.rules.length, replaced, backup }
}
