import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const CLIENT_DIRECTORY = 'client'

/** `client/<name>/<fileName>` for every client that has one, in name order so a merge is reproducible. */
export function clientFiles(agentDir: string, fileName: string): string[] {
	const root = join(agentDir, CLIENT_DIRECTORY)
	if (!existsSync(root)) return []
	return readdirSync(root, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => join(root, entry.name, fileName))
		.filter(path => existsSync(path))
		.toSorted()
}
