import { EventsSDK, LocalPlayer, Modifier } from "github.com/octarine-public/wrapper/index"

import { KNOWN_DOTS as KNOWN_DOT_LIST } from "./debuffs"

const KNOWN_DOTS = new Map<string, number>(KNOWN_DOT_LIST.map(([name, interval]) => [name, interval]))

/**
 * Tracks known ticking debuffs on the hero and reports when the next tick lands, so
 * the abuse can be kept strictly between ticks — a hero parked at 1 HP dies to any of
 * them. Only named debuffs are used: their schedule is exact from the moment they land.
 */
export class DotTracker {
	private readonly known = new Map<Modifier, number>()

	constructor() {
		EventsSDK.on("ModifierCreated", mod => this.Add(mod))
		EventsSDK.on("ModifierRemoved", mod => this.known.delete(mod))
	}

	public Reset(): void {
		this.known.clear()
	}

	/** Absolute RawGameTime of the next tick; Infinity when the hero has no known DoT. */
	public NextTickTime(): number {
		let next = Number.POSITIVE_INFINITY
		for (const [mod, interval] of this.known) {
			if (!mod.IsValid) {
				this.known.delete(mod)
				continue
			}
			next = Math.min(next, this.NextTickOf(mod, interval))
		}
		return next
	}

	private Add(mod: Modifier): void {
		const interval = KNOWN_DOTS.get(mod.Name)
		if (interval !== undefined && mod.Parent === LocalPlayer?.Hero) {
			this.known.set(mod, interval)
		}
	}

	private NextTickOf(mod: Modifier, interval: number): number {
		const ticks = Math.floor(mod.ElapsedTime / interval) + 1
		const tick = mod.CreationTime + ticks * interval
		// A negative duration means the debuff is permanent, so it has no DieTime.
		if (mod.Duration >= 0 && tick > mod.DieTime) {
			return Number.POSITIVE_INFINITY
		}
		return tick
	}
}
