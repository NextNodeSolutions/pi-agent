import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static, TSchema } from 'typebox'

export const nullable = <Schema extends TSchema>(
	schema: Schema,
): ReturnType<typeof Type.Union<[Schema, ReturnType<typeof Type.Null>]>> =>
	Type.Union([schema, Type.Null()])

export function parseJson<Schema extends TSchema>(
	schema: Schema,
	text: string,
): Static<Schema> {
	const parsed: unknown = JSON.parse(text)
	return Value.Parse(schema, parsed)
}
