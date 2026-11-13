/** Herdr terminal label holding a session's title; the Command Center mod reads it under this name. */
export const TITLE_LABEL = 'agent.title'

// The lifecycle sweeper (`skills/agent-lifecycle`) reads these under these names, as does Claude Code's hook for the first.
export const WAITING_LABEL = 'agent.waiting'
export const GOAL_LABEL = 'agent.goal'

/** Pi publishes its session file under this label: a relay's receiver reads the sender's records from it, and the lifecycle sweeper resumes a closed conversation from it. */
export const SESSION_LABEL = 'pi.session'

/** Set on a terminal whose screen `reader` read: when that read happened, in ms since the epoch. */
export const readLabel = (reader: string): string => `agent.read.${reader}`
