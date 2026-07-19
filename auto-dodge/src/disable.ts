import { Ability, EntityManager, GameState, Hero, ImageData, Sleeper } from "github.com/octarine-public/wrapper/index"

const TARGET_SLEEP = 1.2
const TRIGGER_AGE = 0.7
const RANGE_BUFFER = 100

const TRIGGER_SPELLS: ReadonlyMap<string, number> = new Map([
	["spirit_breaker_nether_strike", 900],
	["axe_berserkers_call", 320],
	["legion_commander_duel", 250],
	["faceless_void_chronosphere", 450],
	["nevermore_requiem", 900],
	["magnataur_reverse_polarity", 410],
	["sandking_epicenter", 600]
])

const enum DisableMode {
	Enemy,
	Self,
	NoTarget
}

export interface DisableDef {
	readonly key: string
	readonly isItem: boolean
	readonly names: string[]
	readonly mode: DisableMode
	readonly magic: boolean
	readonly range: number
}

const DISABLE_DEFS: DisableDef[] = [
	{
		key: "bloodthorn",
		isItem: true,
		names: ["item_bloodthorn"],
		mode: DisableMode.Enemy,
		magic: true,
		range: 900
	},
	{ key: "orchid", isItem: true, names: ["item_orchid"], mode: DisableMode.Enemy, magic: true, range: 900 },
	{ key: "sheep", isItem: true, names: ["item_sheepstick"], mode: DisableMode.Enemy, magic: true, range: 800 },
	{ key: "hex", isItem: false, names: ["lion_voodoo"], mode: DisableMode.Enemy, magic: true, range: 500 },
	{
		key: "astral",
		isItem: false,
		names: ["obsidian_destroyer_astral_imprisonment"],
		mode: DisableMode.Enemy,
		magic: true,
		range: 500
	},
	{
		key: "ethereal",
		isItem: true,
		names: ["item_ethereal_blade"],
		mode: DisableMode.Enemy,
		magic: true,
		range: 800
	},
	{
		key: "abyssal",
		isItem: true,
		names: ["item_abyssal_blade"],
		mode: DisableMode.Enemy,
		magic: false,
		range: 350
	},
	{
		key: "eul",
		isItem: true,
		names: ["item_cyclone", "item_wind_waker"],
		mode: DisableMode.Enemy,
		magic: true,
		range: 550
	},
	{
		key: "pike",
		isItem: true,
		names: ["item_hurricane_pike"],
		mode: DisableMode.Enemy,
		magic: true,
		range: 550
	},
	{ key: "force", isItem: true, names: ["item_force_staff"], mode: DisableMode.Enemy, magic: true, range: 800 },
	{
		key: "inner_fire",
		isItem: false,
		names: ["huskar_inner_fire"],
		mode: DisableMode.NoTarget,
		magic: true,
		range: 400
	},
	{ key: "ghost", isItem: true, names: ["item_ghost"], mode: DisableMode.NoTarget, magic: false, range: 0 },
	{
		key: "glimmer",
		isItem: true,
		names: ["item_glimmer_cape"],
		mode: DisableMode.Self,
		magic: false,
		range: 0
	}
]

export class DisableSlot {
	public enabled = true
	public ability: Nullable<Ability>

	constructor(public readonly def: DisableDef) {}

	public get IsFound(): boolean {
		return this.ability !== undefined && this.ability.IsValid
	}

	public get IsShown(): boolean {
		return true
	}

	public get Texture(): string {
		const abil = this.ability
		const name = abil !== undefined && abil.IsValid ? abil.Name : this.def.names[0]
		return this.def.isItem ? ImageData.GetItemTexture(name) : ImageData.GetSpellTexture(name)
	}

	public CanUse(hero: Hero, target: Hero): boolean {
		const abil = this.ability
		if (!this.enabled || abil === undefined || !abil.IsValid || !abil.CanBeCasted()) {
			return false
		}
		if (this.def.isItem ? hero.IsMuted : hero.IsSilenced) {
			return false
		}
		if (this.def.mode === DisableMode.Self) {
			return true
		}
		if (this.def.magic && target.IsMagicImmune) {
			return false
		}
		if (this.def.mode === DisableMode.NoTarget && this.def.range <= 0) {
			return true
		}
		const range = Math.max(abil.CastRange, this.def.range) + RANGE_BUFFER
		return hero.Distance2D(target) <= range
	}

	public Resolve(hero: Hero): void {
		const abil = this.ability
		if (abil !== undefined && abil.IsValid && abil.Owner === hero) {
			return
		}
		this.ability = this.def.isItem
			? hero.Items.find(x => this.def.names.includes(x.Name))
			: hero.Spells.find((x): x is Ability => x !== undefined && this.def.names.includes(x.Name))
	}
}

export function CreateDisableSlots(): DisableSlot[] {
	return DISABLE_DEFS.map(def => new DisableSlot(def))
}

export class AutoDisable {
	private readonly sleeper = new Sleeper()
	private readonly castAt = new Map<number, number>()
	private status = "none"

	constructor(private readonly slots: DisableSlot[]) {}

	public get Status(): string {
		return `dis:${this.status}`
	}

	public Tick(hero: Hero, enabled: boolean, blinkers: Hero[]): void {
		for (const item of this.slots) {
			item.Resolve(hero)
		}
		if (!enabled) {
			this.status = "off"
			return
		}
		if (!hero.IsAlive || hero.IsStunned || hero.IsHexed) {
			this.status = "cant"
			return
		}
		const targets = this.CollectTargets(hero, blinkers)
		if (targets.length === 0) {
			this.status = "watch"
			return
		}

		const now = GameState.RawGameTime
		const used = new Set<DisableSlot>()
		const done: string[] = []
		for (const target of targets) {
			const last = this.castAt.get(target.Index) ?? 0
			if (now - last < TARGET_SLEEP) {
				continue
			}
			if (target.IsHexed || target.IsStunned) {
				continue
			}
			const slot = this.slots.find(x => !used.has(x) && x.CanUse(hero, target))
			if (slot === undefined) {
				continue
			}
			this.Cast(hero, slot, target)
			used.add(slot)
			this.castAt.set(target.Index, now)
			done.push(`${slot.def.key}>${target.Index}`)
		}
		this.Prune(now)
		this.status = done.length !== 0 ? done.join(",") : `hold${targets.length}`
	}

	public Reset(): void {
		this.sleeper.FullReset()
		this.castAt.clear()
		this.status = "none"
	}

	private CollectTargets(hero: Hero, blinkers: Hero[]): Hero[] {
		const targets = blinkers.slice()
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion || !enemy.IsEnemy(hero)) {
				continue
			}
			if (targets.some(x => x.Index === enemy.Index)) {
				continue
			}
			if (this.IsCastingAtUs(enemy, hero)) {
				targets.push(enemy)
			}
		}
		return targets.sort((a, b) => a.Distance2D(hero) - b.Distance2D(hero))
	}

	private IsCastingAtUs(enemy: Hero, hero: Hero): boolean {
		const reach = enemy.Distance2D(hero) - hero.HullRadius
		for (const spell of enemy.Spells) {
			if (spell === undefined || !spell.IsValid) {
				continue
			}
			if (!spell.IsInAbilityPhase && !spell.IsChanneling) {
				continue
			}
			const radius = TRIGGER_SPELLS.get(spell.Name)
			if (radius !== undefined && reach <= radius) {
				return true
			}
		}
		return false
	}

	private Cast(hero: Hero, slot: DisableSlot, target: Hero): void {
		const abil = slot.ability
		if (abil === undefined) {
			return
		}
		if (slot.def.mode === DisableMode.NoTarget) {
			hero.CastNoTarget(abil)
			return
		}
		if (slot.def.mode === DisableMode.Self) {
			hero.CastTarget(abil, hero)
			return
		}
		hero.CastTarget(abil, target)
	}

	private Prune(now: number): void {
		for (const [index, time] of this.castAt) {
			if (now - time > TARGET_SLEEP * 4) {
				this.castAt.delete(index)
			}
		}
	}
}

export const DISABLE_TRIGGER_AGE = TRIGGER_AGE
