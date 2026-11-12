/** The subagents package sets this in every child session it starts. */
export function isSubagentChild(): boolean {
	return process.env.PI_SUBAGENT_CHILD === '1'
}
