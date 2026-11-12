const VALUE_FLAGS = new Set([
	'--domain',
	'--env',
	'-e',
	'--projectId',
	'--path',
	'--profile',
	'--org',
	'--token',
	'--method',
	'--log-level',
	'-l',
	'--log-format',
	'--log-destination',
	'--tags',
	'-t',
	'--output',
	'-o',
	'--format',
	'-f',
	'--output-file',
])
const MACHINE_COMMANDS = new Set([
	'run',
	'secrets',
	'export',
	'dynamic-secrets',
	'secrets-manager',
	'sm',
])
const SESSIONLESS_COMMANDS = new Set(['scan', 'help', 'completion'])
const HELP_FLAGS = new Set(['--help', '-h'])
const ARGUMENT_SEPARATOR = '--'

export type SessionVerdict = 'machine' | 'sessionless' | 'human-session'

export function positionals(tokens: readonly string[]): string[] {
	const words: string[] = []
	let shouldSkip = false
	for (const token of tokens) {
		if (shouldSkip) {
			shouldSkip = false
			continue
		}
		if (token.startsWith('-')) {
			shouldSkip = VALUE_FLAGS.has(token)
			continue
		}
		words.push(token)
	}
	return words
}

// Arguments after -- belong to the injected application, not Infisical.
export function ownArguments(cliArguments: readonly string[]): string[] {
	const separator = cliArguments.indexOf(ARGUMENT_SEPARATOR)
	if (separator === -1) return [...cliArguments]
	return cliArguments.slice(0, separator)
}

// Unknown commands fail closed because the CLI may open an interactive login.
export function sessionVerdict(
	cliArguments: readonly string[],
): SessionVerdict {
	const own = ownArguments(cliArguments)
	if (own.some(token => HELP_FLAGS.has(token))) return 'sessionless'
	const [command, action] = positionals(own)
	if (!command || SESSIONLESS_COMMANDS.has(command)) return 'sessionless'
	if (MACHINE_COMMANDS.has(command)) return 'machine'
	return command === 'login' && action === 'status'
		? 'machine'
		: 'human-session'
}
