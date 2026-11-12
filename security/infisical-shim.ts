import {
	accessSync,
	constants,
	existsSync,
	readFileSync,
	realpathSync,
} from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

import {
	ProjectAccessRefused,
	requireProjectAccess,
} from './infisical-access.ts'
import { ownArguments, sessionVerdict } from './infisical-commands.ts'
import { PROJECT_ID_PATTERN } from './infisical-target.ts'
import protocol from './machine-identity.json' with { type: 'json' }
import {
	MachineIdentityUnavailable,
	machineToken,
	vaultApi,
} from './machine-identity.ts'

const CLI_NAME = 'infisical'
// The CLI reads the YAML link before the legacy JSON one in the same directory.
const LINK_FILES = ['.infisical.yaml', '.infisical.json'] as const
// Either would outrank the pinned domain or the fresh token inside the CLI.
const OVERRIDDEN_VARIABLES = new Set([
	'INFISICAL_API_URL',
	'INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN',
])
const FAILURE_EXIT_CODE = 1
const HUMAN_SESSION_REFUSAL =
	"This Infisical command uses the human's login session, and agents reach the vault only as the machine identity. Use run, secrets, export, secrets-manager or scan; links, projects and anything else are in ~/.pi/agent/skills/infisical/SKILL.md."

function isRealCli(candidate: string, shimDirectory: string): boolean {
	try {
		accessSync(candidate, constants.X_OK)
		return dirname(realpathSync(candidate)) !== shimDirectory
	} catch {
		return false
	}
}

function realCli(launcher: string): string {
	const shimDirectory = dirname(realpathSync(launcher))
	const cli = (process.env.PATH ?? '')
		.split(delimiter)
		.filter(Boolean)
		.map(directory => join(directory, CLI_NAME))
		.find(candidate => isRealCli(candidate, shimDirectory))
	if (!cli) throw new Error('The Infisical CLI is not installed on PATH')
	return cli
}

function linkFile(directory: string): string | undefined {
	const found = LINK_FILES.map(name => join(directory, name)).find(path =>
		existsSync(path),
	)
	const parent = dirname(directory)
	return found || parent === directory ? found : linkFile(parent)
}

function jsonProjectId(text: string): unknown {
	const link: unknown = JSON.parse(text)
	if (typeof link !== 'object' || link === null) return undefined
	return Reflect.get(link, 'workspaceId')
}

function yamlProjectId(text: string): string | undefined {
	const [, section] =
		/^secrets-management:[^\n]*\n((?:[ \t]+[^\n]*(?:\n|$)|[ \t]*\n)*)/mu.exec(
			text,
		) ?? []
	return /^[ \t]+project-id:[ \t]*["']?([\w-]+)/mu.exec(section ?? '')?.[1]
}

// Machine-token secret operations require a project ID even when a link exists.
function linkedProjectId(): string | undefined {
	const file = linkFile(process.cwd())
	if (!file) return undefined
	try {
		const text = readFileSync(file, 'utf8')
		const id = file.endsWith('.json')
			? jsonProjectId(text)
			: yamlProjectId(text)
		const isProjectId =
			typeof id === 'string' &&
			new RegExp(PROJECT_ID_PATTERN, 'u').test(id)
		if (!isProjectId)
			throw new Error(
				'Invalid project ID in the committed Infisical link',
			)
		return id
	} catch {
		throw new Error(
			'The committed Infisical link is unreadable or has no valid project ID',
		)
	}
}

function hasFlag(own: readonly string[], flag: string): boolean {
	return own.some(token => token === flag || token.startsWith(`${flag}=`))
}

function flagValue(own: readonly string[], flag: string): string | undefined {
	const index = own.findIndex(
		token => token === flag || token.startsWith(`${flag}=`),
	)
	const token = own[index]
	if (token === flag) return own[index + 1]
	return token?.slice(flag.length + 1)
}

async function machineVariables(
	own: readonly string[],
): Promise<NodeJS.ProcessEnv> {
	const token = await machineToken()
	const projectId =
		flagValue(own, '--projectId') ??
		process.env.INFISICAL_PROJECT_ID ??
		linkedProjectId()
	if (!projectId) return { INFISICAL_TOKEN: token }
	await requireProjectAccess(token, projectId)
	return { INFISICAL_TOKEN: token, INFISICAL_PROJECT_ID: projectId }
}

async function cliEnvironment(
	cliArguments: readonly string[],
): Promise<NodeJS.ProcessEnv> {
	const inherited = Object.fromEntries(
		Object.entries(process.env).filter(
			([name]) => !OVERRIDDEN_VARIABLES.has(name),
		),
	)
	const environment = {
		...inherited,
		INFISICAL_DOMAIN: vaultApi(),
		INFISICAL_DISABLE_UPDATE_CHECK: 'true',
	}
	if (sessionVerdict(cliArguments) !== 'machine') return environment
	return {
		...environment,
		...(await machineVariables(ownArguments(cliArguments))),
	}
}

function fail(message: string, exitCode: number): void {
	process.stderr.write(`${message}\n`)
	process.exitCode = exitCode
}

export async function runInfisical(
	launcher: string,
	cliArguments: readonly string[],
): Promise<void> {
	const own = ownArguments(cliArguments)
	if (hasFlag(own, '--token') || hasFlag(own, '--domain'))
		return fail(
			'Agent Infisical calls use the bound domain and machine identity, not --token or --domain overrides.',
			protocol.humanSessionExitCode,
		)
	if (sessionVerdict(cliArguments) === 'human-session')
		return fail(HUMAN_SESSION_REFUSAL, protocol.humanSessionExitCode)
	try {
		if (!process.execve)
			throw new Error(
				'This platform cannot replace a process with the CLI',
			)
		const cli = realCli(launcher)
		const environment = await cliEnvironment(cliArguments)
		process.execve(cli, [CLI_NAME, ...cliArguments], environment)
	} catch (error: unknown) {
		if (error instanceof ProjectAccessRefused)
			return fail(error.message, protocol.projectAccessRefusedExitCode)
		const exitCode =
			error instanceof MachineIdentityUnavailable
				? protocol.identityUnavailableExitCode
				: FAILURE_EXIT_CODE
		return fail(
			error instanceof MachineIdentityUnavailable
				? error.message
				: 'Infisical did not start. Check the CLI installation, vault binding and project link.',
			exitCode,
		)
	}
}
