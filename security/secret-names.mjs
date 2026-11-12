import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { ProjectAccessRefused } from './infisical-access.ts'
import protocol from './machine-identity.json' with { type: 'json' }
import { MachineIdentityUnavailable } from './machine-identity.ts'

const MACHINE_CLI = fileURLToPath(new URL('../bin/infisical', import.meta.url))
const IDENTITY_FAILURE =
	'The Infisical machine identity is missing from the environment or refused'
const LOOKUP_FAILURE = 'Names-only lookup failed'
const USAGE =
	'node ~/.pi/agent/security/secret-names.mjs --projectId ID --env ENV [--path /]'
const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 8_388_608

function readOptions() {
	const { values } = parseArgs({
		options: {
			projectId: { type: 'string' },
			env: { type: 'string' },
			path: { type: 'string', default: '/' },
			help: { type: 'boolean', default: false },
		},
	})
	if (values.help) return values
	if (!values.projectId || !/^[a-zA-Z0-9-]+$/.test(values.projectId))
		throw new Error('Invalid project ID')
	if (!values.env || !/^[a-zA-Z0-9_-]+$/.test(values.env))
		throw new Error('Invalid environment')
	if (!values.path.startsWith('/') || /[\r\n\0]/.test(values.path))
		throw new Error('Invalid secret path')
	return values
}

function listNames(options) {
	const commandOutput = spawnSync(
		process.execPath,
		[
			MACHINE_CLI,
			'secrets',
			'generate-example-env',
			'--projectId',
			options.projectId,
			'--env',
			options.env,
			'--path',
			options.path,
			'--silent',
		],
		{
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: TIMEOUT_MS,
			maxBuffer: MAX_OUTPUT_BYTES,
		},
	)
	if (commandOutput.status === protocol.identityUnavailableExitCode)
		throw new MachineIdentityUnavailable(IDENTITY_FAILURE)
	if (commandOutput.status === protocol.projectAccessRefusedExitCode)
		throw new ProjectAccessRefused(commandOutput.stderr.trim())
	if (commandOutput.error || commandOutput.status !== 0)
		throw new Error(LOOKUP_FAILURE)
	const lines = commandOutput.stdout
		.split(/\r?\n/)
		.filter(line => line.trim() && !line.trimStart().startsWith('#'))
	const names = lines.map(line => {
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)
		if (!match) throw new Error('Unexpected names format')
		return match[1]
	})
	return [...new Set(names)].toSorted((left, right) =>
		left.localeCompare(right),
	)
}

try {
	const options = readOptions()
	if (options.help) {
		process.stdout.write(`${USAGE}\n`)
	} else {
		const names = listNames(options)
		process.stdout.write(`${JSON.stringify({ names })}\n`)
	}
} catch (error) {
	const isRefused = error instanceof ProjectAccessRefused
	const reason =
		isRefused || error instanceof MachineIdentityUnavailable
			? error.message
			: LOOKUP_FAILURE
	process.stderr.write(
		`${reason}. No raw output was released. Usage: ${USAGE}\n`,
	)
	process.exitCode = isRefused ? protocol.projectAccessRefusedExitCode : 1
}
