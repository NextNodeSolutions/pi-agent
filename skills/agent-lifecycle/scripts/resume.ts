import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { SESSION_LABEL } from '#lib/ui/herdr-labels.ts'

import type { Terminal } from './terminal.ts'

export type Recipe = { cwd: string; argv: string[] }

type RecipeReader = (terminal: Terminal) => Promise<string[] | null>

const CLAUDE_SESSIONS = join(homedir(), '.claude', 'sessions')
const ClaudeSessionSchema = Type.Object({ sessionId: Type.String() })

const piArguments: RecipeReader = terminal => {
	const session = terminal.labels[SESSION_LABEL]
	return Promise.resolve(session ? ['pi', '--session', session] : null)
}

// Claude Code keeps one file per running process, named after its pid, and removes it at exit.
const claudeArguments: RecipeReader = async terminal => {
	if (terminal.pid === null) return null
	try {
		const text = await readFile(
			join(CLAUDE_SESSIONS, `${terminal.pid}.json`),
			'utf8',
		)
		const parsed: unknown = JSON.parse(text)
		const { sessionId } = Value.Parse(ClaudeSessionSchema, parsed)
		return ['claude', '--resume', sessionId]
	} catch {
		return null
	}
}

const READERS: Readonly<Record<string, RecipeReader>> = {
	pi: piArguments,
	'claude-code': claudeArguments,
}

export async function resumeRecipe(terminal: Terminal): Promise<Recipe | null> {
	const reader = READERS[terminal.app ?? '']
	const argv = reader ? await reader(terminal) : null
	if (!argv) return null
	return { cwd: terminal.cwd, argv }
}
