import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { stateDirectory } from './memory.ts'
import { titleOf } from './terminal.ts'

import type { Recipe } from './resume.ts'
import type { Terminal } from './terminal.ts'

const TRACES_FOLDER = 'traces'
const SLUG_LENGTH = 48
const SCREEN_INDENT = '    '
const STAMP_LENGTH = 'YYYYMMDDTHHMMSS'.length

export type TraceInput = {
	terminal: Terminal
	reason: string
	screen: string
	recipe: Recipe
	branch: string | null
	atMs: number
}

const stamp = (atMs: number): string =>
	new Date(atMs).toISOString().replace(/[-:]/g, '').slice(0, STAMP_LENGTH)

const slug = (title: string): string =>
	title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, SLUG_LENGTH)

export const reopenCommand = (address: string): string =>
	`agent-lifecycle reopen ${address}`

function traceText(input: TraceInput): string {
	const { terminal, recipe } = input
	const screen = input.screen
		.trimEnd()
		.split('\n')
		.map(line => `${SCREEN_INDENT}${line}`)
	return [
		`# ${titleOf(terminal)}`,
		'',
		`Closed ${new Date(input.atMs).toISOString()} by the lifecycle policy: ${input.reason}.`,
		'',
		`- Terminal: ${terminal.address}, ${terminal.app ?? 'unknown program'}, turn ${terminal.turn}`,
		`- Folder: ${recipe.cwd}`,
		`- Branch: ${input.branch ?? 'none'}`,
		`- Reopen: \`${reopenCommand(terminal.address)}\``,
		`- It runs \`${recipe.argv.join(' ')}\` in that folder.`,
		'',
		'## Last screen',
		'',
		...screen,
		'',
	].join('\n')
}

export function writeTrace(input: TraceInput): string {
	const folder = join(stateDirectory(), TRACES_FOLDER)
	mkdirSync(folder, { recursive: true })
	const { terminal } = input
	const file = `${stamp(input.atMs)}-${terminal.address}-${slug(titleOf(terminal))}.md`
	const path = join(folder, file)
	writeFileSync(path, traceText(input))
	return path
}
