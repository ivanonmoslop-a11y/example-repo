import { GameState, Hero, ImageData, Item, Sleeper } from "github.com/octarine-public/wrapper/index"

const CAST_SLEEP_MS = 900
const TRIGGER_AGE = 0.7
const RANGE_BUFFER = 100

const enum DisableMode {
	Enemy,
	Self,
	NoTarget
}

export interface DisableDef {
	readonly key: string
	readonly names: string[]
	readonly mode: DisableMode
	readonly magic: boolean
	readonly range: number
}

const DISABLE_DEFS: DisableDef[] = [
	{ key: "bloodthorn", names: ["item_bloodthorn"], mode: DisableMode.Enemy, magic: true, range: 900 },
	{ key: "orchid", names: ["item_orchid"], mode: DisableMode.Enemy, magic: true, range: 900 },
	{ key: "sheep", names: ["item_sheepstick"], mode: DisableMode.Enemy, magic: true, range: 800 },
	{ key: "ethereal", names: ["item_ethereal_blade"], mode: DisableMode.Enemy, magic: true, range: 800 },
	{ key: "abyssal", names: ["item_abyssal_blade"], mode: DisableMode.Enemy, magic: false, range: 350 },
	{
		key: "eul",
		names: ["item_cyclone", "item_wind_waker"],
		mode: DisableMode.Enemy,
		magic: true,
		range: 550
	},
	{ key: "ghost", names: ["item_ghost"], mode: DisableMode.NoTarget, magic: false, range: 0 },
	{ key: "glimmer", names: ["item_glimmer_cape"], mode: DisableMode.Self, magic: false, range: 800 }
]

export class DisableSlot {
	public enabled = true
	public ability: Nullable<Item>

	constructor(public readonly def: DisableDef) {}

	public get IsFound(): boolean {
		return this.ability !== undefined && this.ability.IsValid
	}

	public get Texture(): string {
		const abil = this.ability
		const name = abil !== undefined && abil.IsValid ? abil.Name : this.def.names[0]
		return ImageData.GetItemTexture(name)
	}

	public CanUse(hero: Hero, target: Hero): boolean {
		const abil = this.ability
		if (!this.enabled || abil === undefined || !abil.IsValid || !abil.CanBeCasted()) {
			return false
		}
		if (hero.IsMuted) {
			return false
		}
		if (this.def.mode !== DisableMode.Enemy) {
			return true
		}
		if (this.def.magic && target.IsMagicImmune) {
			return false
		}
		const range = Math.max(abil.CastRange, this.def.range) + RANGE_BUFFER
		return hero.Distance2D(target) <= range
	}

	public Resolve(hero: Hero): void {
		const abil = this.ability
		if (abil !== undefined && abil.IsValid && abil.Owner === hero) {
			return
		}
		this.ability = hero.Items.find(x => this.def.names.includes(x.Name))
	}
}

export function CreateDisableSlots(): DisableSlot[] {
	return DISABLE_DEFS.map(def => new DisableSlot(def))
}

export class AutoDisable {
	private readonly sleeper = new Sleeper()
	private status = "none"

	constructor(private readonly slots: DisableSlot[]) {}

	public get Status(): string {
		return `dis:${this.status}`
	}

	public Tick(hero: Hero, enabled: boolean, target: Nullable<Hero>): void {
		for (const item of this.slots) {
			item.Resolve(hero)
		}
		if (!enabled) {
			this.status = "off"
			return
		}
		if (!hero.IsAlive || hero.IsStunned || hero.IsHexed || hero.IsMuted) {
			this.status = "cant"
			return
		}
		if (target === undefined) {
			this.status = "watch"
			return
		}
		if (this.sleeper.Sleeping("disable")) {
			this.status = "cd"
			return
		}
		if (target.IsHexed || target.IsStunned) {
			this.status = "held"
			return
		}
		const slot = this.slots.find(x => x.CanUse(hero, target))
		if (slot === undefined) {
			this.status = "no-item"
			return
		}
		const abil = slot.ability
		if (abil === undefined) {
			this.status = "no-item"
			return
		}
		if (slot.def.mode === DisableMode.NoTarget) {
			hero.CastNoTarget(abil)
		} else if (slot.def.mode === DisableMode.Self) {
			hero.CastTarget(abil, hero)
		} else {
			hero.CastTarget(abil, target)
		}
		this.sleeper.Sleep(CAST_SLEEP_MS, "disable")
		this.status = `${slot.def.key}@${Math.round(GameState.RawGameTime)}`
	}

	public Reset(): void {
		this.sleeper.FullReset()
		this.status = "none"
	}
}

export const DISABLE_TRIGGER_AGE = TRIGGER_AGE
