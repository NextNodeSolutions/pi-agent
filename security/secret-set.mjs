import { parseArgs } from 'node:util'

import { requireProjectAccess } from './infisical-access.ts'
import { call, HTTP_OK, names, secretsApi } from './infisical-rest.ts'
import { describeTarget, parseSecretTarget } from './infisical-target.ts'
import { machineToken } from './machine-identity.ts'

const USAGE =
	'node ~/.pi/agent/security/secret-set.mjs --projectId ID --env ENV --name NAME [--path /] [--replace]  (value: masked prompt in a terminal, otherwise stdin)'
const MAX_VALUE_LENGTH = 32_768
const ENTER = /[\r\n]/u
const CTRL_C = '\u0003'
const CTRL_D = '\u0004'
const BACKSPACE = /[\b\u007f]/u

function readOptions() {
	const { values } = parseArgs({
		options: {
			projectId: { type: 'string' },
			env: { type: 'string' },
			name: { type: 'string' },
			path: { type: 'string', default: '/' },
			replace: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false },
		},
	})
	if (values.help) return { help: true }
	return {
		help: false,
		replace: values.replace,
		target: parseSecretTarget({
			projectId: values.projectId,
			environment: values.env,
			path: values.path,
			name: values.name,
		}),
	}
}

function readMaskedValue(target) {
	return new Promise((resolve, reject) => {
		const { stdin, stderr } = process
		let typed = ''
		const finish = (settle, outcome) => {
			stdin.setRawMode(false)
			stdin.pause()
			stdin.off('data', onData)
			stderr.write('\n')
			settle(outcome)
		}
		const onData = chunk => {
			for (const char of chunk.toString('utf8')) {
				if (char === CTRL_C || char === CTRL_D)
					return finish(reject, new Error('Cancelled'))
				if (ENTER.test(char)) return finish(resolve, typed)
				if (BACKSPACE.test(char)) typed = typed.slice(0, -1)
				else if (char >= ' ') typed += char
			}
			return undefined
		}
		stderr.write(`Value for ${describeTarget(target)}: `)
		stdin.setRawMode(true)
		stdin.resume()
		stdin.setEncoding('utf8')
		stdin.on('data', onData)
	})
}

async function readPipedValue() {
	const chunks = []
	for await (const chunk of process.stdin) chunks.push(chunk)
	return Buffer.concat(chunks)
		.toString('utf8')
		.replace(/\r?\n$/u, '')
}

async function readValue(target) {
	const secretValue = process.stdin.isTTY
		? await readMaskedValue(target)
		: await readPipedValue()
	if (!secretValue) throw new Error('Empty value')
	if (secretValue.length > MAX_VALUE_LENGTH) throw new Error('Value too long')
	return secretValue
}

async function setSecret(options) {
	const { target } = options
	const where = {
		workspaceId: target.workspaceId,
		environment: target.environment,
	}
	const token = await machineToken()
	await requireProjectAccess(token, target.workspaceId)
	const secretValue = await readValue(target)
	const exists = (await names(token, where, target.path)).includes(
		target.name,
	)
	if (exists && !options.replace)
		throw new Error(
			`${target.name} already exists in the target, pass --replace to overwrite it`,
		)
	const write = await call(
		token,
		exists ? 'PATCH' : 'POST',
		`${secretsApi()}/${target.name}`,
		{ ...where, secretPath: target.path, secretValue },
	)
	if (write.status !== HTTP_OK)
		throw new Error(`Write failed: HTTP ${write.status}`)
	if (!(await names(token, where, target.path)).includes(target.name))
		throw new Error(`${target.name} is not in the target after the write`)
	process.stdout.write(
		`${target.name}: ${exists ? 'updated' : 'created'} in ${target.workspaceId}/${target.environment}${target.path}\n`,
	)
}

try {
	const options = readOptions()
	if (options.help) process.stdout.write(`${USAGE}\n`)
	else await setSecret(options)
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : 'Failed'}. No value was printed. Usage: ${USAGE}\n`,
	)
	process.exitCode = 1
}
