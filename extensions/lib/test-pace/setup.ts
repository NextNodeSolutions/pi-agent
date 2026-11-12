import { NODE_TEST_RUNNER } from './paths.ts'

function parsedManifest(content: string): unknown {
	try {
		return JSON.parse(content)
	} catch {
		return {}
	}
}

function testSetup(content: string): string {
	const manifest = parsedManifest(content)
	const scripts: unknown = Reflect.get(Object(manifest), 'scripts')
	const dependencies = [
		'dependencies',
		'devDependencies',
		'optionalDependencies',
	].flatMap(section => {
		const packages: unknown = Reflect.get(Object(manifest), section)
		return Object.keys(Object(packages)).filter(name =>
			NODE_TEST_RUNNER.test(name),
		)
	})
	const commands = Object.entries(Object(scripts)).filter(
		([name, command]) =>
			/^test(?::|$)/.test(name) ||
			(typeof command === 'string' && NODE_TEST_RUNNER.test(command)),
	)
	return JSON.stringify({
		commands: commands.toSorted(),
		dependencies: dependencies.toSorted(),
	})
}

export function changesTestSetup(before: string, after: string): boolean {
	return testSetup(before || '{}') !== testSetup(after)
}

export function proposedContent(
	tool: string,
	input: unknown,
	before: string,
): string {
	if (tool === 'write') {
		const content: unknown = Reflect.get(Object(input), 'content')
		if (typeof content !== 'string')
			throw new Error('Expected write content.')
		return content
	}
	const edits: unknown = Reflect.get(Object(input), 'edits')
	if (!Array.isArray(edits))
		throw new Error('Expected exact edit replacements.')
	return edits.reduce((content: string, edit: unknown) => {
		const oldText: unknown = Reflect.get(Object(edit), 'oldText')
		const newText: unknown = Reflect.get(Object(edit), 'newText')
		if (typeof oldText !== 'string' || typeof newText !== 'string')
			throw new Error('Expected exact edit text.')
		return content.replace(oldText, () => newText)
	}, before)
}
