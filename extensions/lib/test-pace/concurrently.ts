/** Runs `run` on every item, at most `limit` at a time; results keep the items' order. */
export async function mapConcurrently<Item, Result>(
	items: readonly Item[],
	limit: number,
	run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
	const queue = [...items.entries()]
	const results: Result[] = []
	async function next(): Promise<void> {
		const task = queue.shift()
		if (!task) return
		const [index, item] = task
		results[index] = await run(item)
		await next()
	}
	await Promise.all(Array.from({ length: limit }, next))
	return results
}
