import { parseArgs } from 'node:util'

import { errorText } from '#lib/error-text.ts'

import { writeClosedPage } from './page.ts'
import { loadPolicy, renderPolicy } from './policy.ts'
import { keepOpen, reopen } from './reopen.ts'
import { renderSweep } from './report.ts'
import { sweep } from './sweep.ts'

const USAGE = `usage: agent-lifecycle <command>
  sweep [--apply] [--attached <t,t>] [--no-window] [--json]   list what would close; --apply closes it
  closed                                                      what was closed, when and why
  reopen <terminal>                                           restart a closed terminal on its conversation
  keep <terminal> [--off]                                     keep one terminal open, or let it close again
  policy                                                      the rules, one row per class
Every command takes --policy <file> to read another policy.`

const USAGE_EXIT_CODE = 64

type Flags = {
	apply: boolean
	json: boolean
	off: boolean
	'no-window': boolean
	attached?: string
	policy?: string
}

type Command = (operands: string[], flags: Flags) => Promise<string>

class UsageError extends Error {}

function operand(operands: string[]): string {
	const [first] = operands
	if (!first) throw new UsageError('this command needs a terminal')
	return first
}

const COMMANDS: Readonly<Record<string, Command>> = {
	sweep: async (_operands, flags) => {
		const report = await sweep({
			mode: flags.apply ? 'apply' : 'dry-run',
			attached: flags.attached?.split(',').filter(Boolean) ?? [],
			window: flags['no-window'] ? 'skip' : 'ask',
			policyFile: flags.policy ?? null,
		})
		return flags.json ? JSON.stringify(report) : renderSweep(report)
	},
	closed: () => {
		const { path, page } = writeClosedPage()
		return Promise.resolve(`${path}\n\n${page}`)
	},
	reopen: async (operands, flags) => {
		const reopened = await reopen(operand(operands), flags.policy ?? null)
		writeClosedPage()
		const verb = reopened.isAlreadyOpen ? 'is already open' : 'reopened'
		return `${reopened.from} ${verb} as ${reopened.as}`
	},
	keep: async (operands, flags) => {
		const terminal = operand(operands)
		await keepOpen(terminal, !flags.off, flags.policy ?? null)
		return flags.off
			? `${terminal} follows the policy again`
			: `${terminal} stays open until \`agent-lifecycle keep ${terminal} --off\``
	},
	policy: (_operands, flags) =>
		Promise.resolve(renderPolicy(loadPolicy(flags.policy ?? null))),
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			apply: { type: 'boolean', default: false },
			json: { type: 'boolean', default: false },
			off: { type: 'boolean', default: false },
			'no-window': { type: 'boolean', default: false },
			attached: { type: 'string' },
			policy: { type: 'string' },
		},
	})
	const [name = '', ...operands] = positionals
	const command = COMMANDS[name]
	if (!command) throw new UsageError(`unknown command: ${name || '(none)'}`)
	process.stdout.write(`${await command(operands, values)}\n`)
}

try {
	await main()
} catch (error) {
	const detail = errorText(error)
	const isUsage =
		error instanceof UsageError ||
		(error instanceof TypeError && 'code' in error)
	process.stderr.write(
		isUsage
			? `agent-lifecycle: ${detail}\n${USAGE}\n`
			: `agent-lifecycle: ${detail}\n`,
	)
	process.exitCode = isUsage ? USAGE_EXIT_CODE : 1
}
