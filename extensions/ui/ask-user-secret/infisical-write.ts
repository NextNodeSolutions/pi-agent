/**
 * Writes a value to Infisical through the house script, which alone talks to
 * the vault: the value travels on the child's stdin and the output names the
 * key only.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type { SecretTarget } from '../../../security/infisical-target.ts'

const SCRIPT = fileURLToPath(
	new URL('../../../security/secret-set.mjs', import.meta.url),
)
const WRITE_TIMEOUT_MS = 60_000

export interface StoredSecret {
	target: string
	operation: string
}

export function writeSecret(
	target: SecretTarget,
	shouldReplace: boolean,
	secretValue: string,
	signal: AbortSignal | undefined,
): Promise<StoredSecret> {
	const args = [
		SCRIPT,
		'--projectId',
		target.workspaceId,
		'--env',
		target.environment,
		'--path',
		target.path,
		'--name',
		target.name,
		...(shouldReplace ? ['--replace'] : []),
	]
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			signal: signal
				? AbortSignal.any([
						signal,
						AbortSignal.timeout(WRITE_TIMEOUT_MS),
					])
				: AbortSignal.timeout(WRITE_TIMEOUT_MS),
		})
		let stdout = ''
		let stderr = ''
		child.stdout.setEncoding('utf8').on('data', chunk => {
			stdout += chunk
		})
		child.stderr.setEncoding('utf8').on('data', chunk => {
			stderr += chunk
		})
		child.on('error', () =>
			reject(
				new Error('Secret write did not run; no value was printed.'),
			),
		)
		child.on('close', code => {
			if (code === 0) resolve(parseOutcome(stdout, target))
			else reject(new Error(stderr.trim() || 'Secret write failed.'))
		})
		child.stdin.on('error', () => undefined)
		child.stdin.end(secretValue)
	})
}

/** The script prints `${name}: created|updated in ${location}`. */
function parseOutcome(stdout: string, target: SecretTarget): StoredSecret {
	const [, operation, location] =
		/^[A-Za-z_][A-Za-z0-9_]*: (created|updated) in (\S+)$/m.exec(stdout) ??
		[]
	return {
		operation: operation ?? 'written',
		target: `${location ?? `${target.workspaceId}/${target.environment}${target.path}`} ${target.name}`,
	}
}
