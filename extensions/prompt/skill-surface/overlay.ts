import type { SkillSurfaceConfig } from './scope.ts'

function mergeRecords<Entry>(
	base: Record<string, Entry> | undefined,
	overlay: Record<string, Entry> | undefined,
	label: string,
): Record<string, Entry> {
	const clashes = Object.keys(overlay ?? {}).filter(
		key => base && Object.hasOwn(base, key),
	)
	if (clashes.length)
		throw new Error(
			`skills.json: ${label} ${clashes.join(', ')} defined twice`,
		)
	return { ...base, ...overlay }
}

/** A client's `skills.json` adds hidden skills, projects and autoloads; it never redefines one. */
export function mergeSkillSurfaceConfigs(
	base: SkillSurfaceConfig,
	overlay: SkillSurfaceConfig,
): SkillSurfaceConfig {
	return {
		hidden: [...(base.hidden ?? []), ...(overlay.hidden ?? [])],
		projects: mergeRecords(base.projects, overlay.projects, 'project'),
		autoload: mergeRecords(base.autoload, overlay.autoload, 'autoload'),
	}
}
