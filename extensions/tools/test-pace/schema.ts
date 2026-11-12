import { Type } from 'typebox'

export const testPaceParameters = Type.Object({
	intent: Type.String({
		minLength: 1,
		maxLength: 800,
		description:
			'Name the reproduced bug or new branching requirement and the public output the test checks.',
	}),
	paths: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
		minItems: 1,
		maxItems: 12,
		description:
			'Exact new test file paths, relative to cwd. No directories, configs, fixtures or end-to-end suites.',
	}),
})
