import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const TIMEOUT_MS = 10_000

export type Checkout = {
	root: string
	isLinked: boolean
	branch: string | null
}

async function git(folder: string, args: string[]): Promise<string[]> {
	const { stdout } = await execute('git', ['-C', folder, ...args], {
		timeout: TIMEOUT_MS,
	})
	return stdout.trim().split('\n')
}

export async function checkoutOf(folder: string): Promise<Checkout | null> {
	try {
		const [root, gitDirectory, commonDirectory] = await git(folder, [
			'rev-parse',
			'--path-format=absolute',
			'--show-toplevel',
			'--git-dir',
			'--git-common-dir',
		])
		if (!root) return null
		const [branch] = await git(folder, ['branch', '--show-current'])
		return {
			root,
			isLinked: gitDirectory !== commonDirectory,
			branch: branch || null,
		}
	} catch {
		return null
	}
}

export const isInside = (folder: string, root: string): boolean =>
	folder === root || folder.startsWith(`${root}/`)
