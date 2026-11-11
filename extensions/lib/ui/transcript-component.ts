/** Stateless transcript renderer: no cached output, each render uses the current viewport. */
import type { Component } from '@earendil-works/pi-tui'

export class TranscriptComponent implements Component {
	constructor(private readonly build: (width: number) => string[]) {}
	invalidate(): void {
		// Pi requires this hook even for stateless renderers.
		return
	}
	render(width: number): string[] {
		return this.build(width)
	}
}
