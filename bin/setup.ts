import { execFileSync } from 'node:child_process'
import {
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Settings = Record<string, unknown>

const AGENT_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)))
const SETTINGS = join(AGENT_DIRECTORY, 'settings.json')
const PINNED = join(AGENT_DIRECTORY, 'settings.pinned.json')
const DEFAULTS = join(AGENT_DIRECTORY, 'settings.defaults.json')
const LOCKFILE = 'pnpm-lock.yaml'
const PACKAGES = join(AGENT_DIRECTORY, 'packages')
const JSON_INDENT = 2

function isSettings(value: unknown): value is Settings {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSettings(path: string): Settings {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
	if (!isSettings(parsed))
		throw new Error(`${path} must hold a JSON object; fix or delete it.`)
	return parsed
}

function merge(base: Settings, override: Settings): Settings {
	const merged: Settings = { ...base }
	for (const [key, value] of Object.entries(override)) {
		const current = merged[key]
		merged[key] =
			isSettings(current) && isSettings(value) ? merge(current, value) : value
	}
	return merged
}

function changedKeys(before: Settings, after: Settings): string[] {
	return Object.keys(after).filter(
		(key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
	)
}

function writeSettings(settings: Settings): void {
	const temporary = `${SETTINGS}.setup.tmp`
	writeFileSync(
		temporary,
		`${JSON.stringify(settings, null, JSON_INDENT)}\n`,
	)
	renameSync(temporary, SETTINGS)
}

function applySettings(): void {
	const pinned = readSettings(PINNED)
	if (!existsSync(SETTINGS)) {
		writeSettings(merge(readSettings(DEFAULTS), pinned))
		console.log('settings.json created from settings.defaults.json and settings.pinned.json')
		return
	}
	const live = readSettings(SETTINGS)
	const next = merge(live, pinned)
	const reset = changedKeys(live, next)
	if (reset.length === 0) {
		console.log('settings.json already matches settings.pinned.json')
		return
	}
	writeSettings(next)
	console.log(`settings.json: reset to settings.pinned.json: ${reset.join(', ')}`)
}

function installDependencies(): void {
	const roots = [
		AGENT_DIRECTORY,
		...readdirNames(PACKAGES).map((name) => join(PACKAGES, name)),
	].filter((root) => existsSync(join(root, LOCKFILE)))
	for (const root of roots) {
		console.log(`pnpm install in ${root}`)
		execFileSync(
			'pnpm',
			['install', '--frozen-lockfile', '--config.strict-dep-builds=false'],
			{ cwd: root, stdio: 'inherit' },
		)
	}
}

function readdirNames(path: string): string[] {
	if (!existsSync(path)) return []
	return readdirSync(path, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
}

applySettings()
installDependencies()
