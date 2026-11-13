import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const STATE_FOLDER = 'agent-lifecycle'

export function stateDirectory(): string {
	const base =
		process.env['XDG_STATE_HOME'] ?? join(homedir(), '.local', 'state')
	return join(base, STATE_FOLDER)
}

export function writeAtomically(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true })
	const draft = `${path}.${process.pid}.tmp`
	writeFileSync(draft, text)
	renameSync(draft, path)
}

export function readOrNull(path: string): string | null {
	try {
		return readFileSync(path, 'utf8')
	} catch (error) {
		if (
			error instanceof Error &&
			'code' in error &&
			error.code === 'ENOENT'
		)
			return null
		throw error
	}
}
