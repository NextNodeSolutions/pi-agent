import { browserOperation } from './browser-operation.ts'
import { SerialQueue } from './serial-queue.ts'

export class BrowserOperations {
	private queue = new SerialQueue()
	private lifetime = new AbortController()
	private activeSignal: AbortSignal | undefined
	private close: () => Promise<void>

	constructor(close: () => Promise<void>) {
		this.close = close
	}

	get signal(): AbortSignal | undefined {
		return this.activeSignal
	}

	run<Result>(
		operation: () => Promise<Result>,
		signal: AbortSignal | undefined,
		timeoutMs: number,
	): Promise<Result> {
		const lifetime = AbortSignal.any([
			this.lifetime.signal,
			...(signal ? [signal] : []),
		])
		return this.queue.run(
			() =>
				browserOperation(
					async active => {
						this.activeSignal = active
						try {
							return await operation()
						} finally {
							this.activeSignal = undefined
						}
					},
					this.close,
					{ signal: lifetime, timeoutMs },
				),
			lifetime,
		)
	}

	async shutdown(): Promise<void> {
		this.lifetime.abort(new Error('Frontend session closed.'))
		await this.queue.run(this.close)
	}
}
