/** Paths a shell command writes, read from its literal words; a guardrail, not a sandbox. */
import { basename } from 'node:path'

export type ShellWrites = {
	/** Written whatever the operand names. */
	certain: string[]
	/** Git reads these as paths only when they exist; otherwise they are refs. */
	ifExisting: string[]
	/** A directory change makes relative operands unresolvable from the session cwd. */
	changesDirectory: boolean
}

type Segment = { words: string[]; targets: string[]; readsHeredoc: boolean }
type Role = 'word' | 'target' | 'ignored'

const TOKEN =
	/[\t \r]*(?:(\d*>&[\d-]+)|(\d*>>?[|&]?|&>>?)|(<<<?-?|<)|(\|\||&&|[|&;\n()`])|((?:[^\s'"\\|&;<>()`]+|'[^']*'|"(?:[^"\\]|\\[\s\S])*"|\\[\s\S])+))/g
const WORD_PART = /'([^']*)'|"((?:[^"\\]|\\[\s\S])*)"|\\([\s\S])|([^'"\\]+)/g
const HEREDOC_BODY =
	/(<<-?[\t ]*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?\n[\t ]*\3(?=\n|$)/g
const PREFIX = /^(?:sudo|command|builtin|env|time|nohup|exec|[A-Za-z_]\w*=.*)$/
const EVERY_OPERAND = new Set([
	'rm',
	'unlink',
	'shred',
	'touch',
	'tee',
	'truncate',
	'mv',
])
const LAST_OPERAND = new Set(['cp', 'ln', 'rsync', 'install'])
const IN_PLACE_EDITORS = new Set(['sed', 'perl', 'ruby'])
const GIT_PATH_COMMANDS = new Set(['checkout', 'restore', 'clean', 'rm', 'mv'])
const DIRECTORY_COMMANDS = new Set(['cd', 'pushd', 'popd'])
const INTERPRETER = /^(?:node|bun|deno|tsx|python[\d.]*|perl|ruby|php)$/
const SHELL = /^(?:ba|z|da|k)?sh$/
const IN_PLACE_FLAG = /^(?:-[a-zA-Z]*i|--in-place)/
const SCRIPT_FLAG = /^(?:-[a-zA-Z]*[ef]|--expression|--file)$/
const INLINE_CODE_FLAG = /^(?:-[a-zA-Z]*[ecp]|--eval|--print)$/
const SHELL_CODE_FLAG = /^-[a-zA-Z]*c$/
const WRITE_CALL =
	/\b(?:write|append|unlink|rm|remove|delete|rename|copy|truncate|open)\w*\s*\(/i
const CODE_WORD_BREAK = /[^\w./@~*-]+/
const NONE: ShellWrites = {
	certain: [],
	ifExisting: [],
	changesDirectory: false,
}

function literalWord(source: string): string {
	return [...source.matchAll(WORD_PART)]
		.map(
			([, single, double, escaped, bare]) =>
				single ?? double ?? escaped ?? bare ?? '',
		)
		.join('')
}

function emptySegment(): Segment {
	return { words: [], targets: [], readsHeredoc: false }
}

function roleAfter(output?: string, input?: string): Role {
	if (output) return 'target'
	return input ? 'ignored' : 'word'
}

function shellSegments(command: string): Segment[] {
	let current = emptySegment()
	let role: Role = 'word'
	const segments = [current]
	for (const [, duplicate, output, input, separator, word] of command
		.replaceAll(HEREDOC_BODY, '$1')
		.matchAll(TOKEN)) {
		if (duplicate) continue
		if (separator) {
			current = emptySegment()
			segments.push(current)
		}
		if (input?.startsWith('<<')) current.readsHeredoc = true
		if (word && role === 'target') current.targets.push(literalWord(word))
		if (word && role === 'word') current.words.push(literalWord(word))
		role = roleAfter(output, input)
	}
	return segments
}

function isOperand(word: string): boolean {
	return word !== '' && !word.startsWith('-')
}

function editedFiles(args: string[]): string[] {
	const files = args.filter(
		(arg, index) =>
			isOperand(arg) && !SCRIPT_FLAG.test(args[index - 1] ?? ''),
	)
	return args.some(arg => SCRIPT_FLAG.test(arg)) ? files : files.slice(1)
}

function gitWrites(args: string[]): ShellWrites {
	const start = args.findIndex(
		(arg, index) =>
			isOperand(arg) && !/^-[Cc]$/.test(args[index - 1] ?? ''),
	)
	const [subcommand = '', ...rest] = start < 0 ? [] : args.slice(start)
	const changesDirectory = args.slice(0, Math.max(start, 0)).includes('-C')
	if (!GIT_PATH_COMMANDS.has(subcommand)) return { ...NONE, changesDirectory }
	const unstagesOnly =
		subcommand === 'restore' &&
		rest.some(arg => arg === '--staged' || arg === '-S') &&
		!rest.some(arg => arg === '--worktree' || arg === '-W')
	if (unstagesOnly) return { ...NONE, changesDirectory }
	const separator = rest.indexOf('--')
	return {
		certain: separator < 0 ? [] : rest.slice(separator + 1),
		ifExisting: (separator < 0 ? rest : rest.slice(0, separator)).filter(
			isOperand,
		),
		changesDirectory,
	}
}

function runsInlineCode(args: string[]): boolean {
	const flag = args.findIndex(arg => INLINE_CODE_FLAG.test(arg))
	const script = args.findIndex(isOperand)
	return flag >= 0 && (script < 0 || flag < script)
}

function valueAfter(args: string[], flag: RegExp): string {
	const index = args.findIndex(arg => flag.test(arg))
	return index < 0 ? '' : (args[index + 1] ?? '')
}

function findWrites(args: string[]): string[] {
	const executed = basename(valueAfter(args, /^-exec(?:dir)?$/))
	const mutates =
		args.includes('-delete') ||
		EVERY_OPERAND.has(executed) ||
		LAST_OPERAND.has(executed)
	return mutates ? args.filter(isOperand) : []
}

function commandWords(words: string[]): string[] {
	const start = words.findIndex(word => !PREFIX.test(word))
	return start < 0 ? [] : words.slice(start)
}

function commandWrites(words: string[], inlineCode: string): ShellWrites {
	const [command = '', ...args] = commandWords(words)
	const name = basename(command)
	const operands = args.filter(isOperand)
	if (DIRECTORY_COMMANDS.has(name)) return { ...NONE, changesDirectory: true }
	if (EVERY_OPERAND.has(name)) return { ...NONE, certain: operands }
	if (LAST_OPERAND.has(name)) return { ...NONE, certain: operands.slice(-1) }
	if (name === 'git') return gitWrites(args)
	if (name === 'find') return { ...NONE, certain: findWrites(args) }
	if (name === 'eval') return shellWrites(args.join(' '))
	if (SHELL.test(name)) return shellWrites(valueAfter(args, SHELL_CODE_FLAG))
	if (IN_PLACE_EDITORS.has(name) && args.some(arg => IN_PLACE_FLAG.test(arg)))
		return { ...NONE, certain: editedFiles(args) }
	if (INTERPRETER.test(name) && WRITE_CALL.test(inlineCode))
		return { ...NONE, certain: inlineCode.split(CODE_WORD_BREAK) }
	return NONE
}

function segmentWrites(segment: Segment, command: string): ShellWrites {
	const inline =
		segment.readsHeredoc ||
		runsInlineCode(commandWords(segment.words).slice(1))
	const found = commandWrites(segment.words, inline ? command : '')
	return {
		certain: found.certain.concat(
			segment.targets.filter(target => !target.startsWith('/dev/')),
		),
		ifExisting: found.ifExisting,
		changesDirectory: found.changesDirectory,
	}
}

export function shellWrites(command: string): ShellWrites {
	const writes = shellSegments(command).map(segment =>
		segmentWrites(segment, command),
	)
	return {
		certain: writes.flatMap(write => write.certain),
		ifExisting: writes.flatMap(write => write.ifExisting),
		changesDirectory: writes.some(write => write.changesDirectory),
	}
}
