import { basename, dirname, resolve } from 'node:path'

import { runtimeFor } from '#lib/runtime/runtime.ts'

export async function physicalPath(path: string): Promise<string> {
	const runtime = runtimeFor(path)
	try {
		return await runtime.realpath(path)
	} catch (error: unknown) {
		if (
			!(error instanceof Error) ||
			Reflect.get(error, 'code') !== 'ENOENT'
		)
			throw error
	}
	const parent = dirname(path)
	if (parent === path) throw new Error('Cannot resolve the test target root.')
	if (await runtime.exists(parent)) {
		const linked = (await runtime.listDirectory(parent)).find(
			entry => entry.name === basename(path),
		)
		if (linked?.isSymbolicLink)
			throw new Error(
				'A broken symbolic link cannot receive test permission.',
			)
	}
	return resolve(await physicalPath(parent), basename(path))
}
