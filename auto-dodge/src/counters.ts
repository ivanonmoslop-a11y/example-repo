import { Ability, Hero, ImageData } from "github.com/octarine-public/wrapper/index"

export const enum CastMode {
	Self,
	NoTarget
}

export interface CounterDef {
	readonly key: string
	readonly isItem: boolean
	readonly names: string[]
	readonly mode: CastMode
	readonly vsProjectile: boolean
	readonly vsCast: boolean
}

const ITEM_DEFS: CounterDef[] = [
	{
		key: "manta",
		isItem: true,
		names: ["item_manta"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: false
	},
	{
		key: "eul",
		isItem: true,
		names: ["item_cyclone", "item_wind_waker"],
		mode: CastMode.Self,
		vsProjectile: true,
		vsCast: true
	},
	{
		key: "lotus",
		isItem: true,
		names: ["item_lotus_orb"],
		mode: CastMode.Self,
		vsProjectile: true,
		vsCast: true
	},
	{
		key: "glimmer",
		isItem: true,
		names: ["item_glimmer_cape"],
		mode: CastMode.Self,
		vsProjectile: true,
		vsCast: true
	},
	{
		key: "bkb",
		isItem: true,
		names: ["item_black_king_bar"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true
	}
]

const ABILITY_DEFS: CounterDef[] = [
	{
		key: "phase_shift",
		isItem: false,
		names: ["puck_phase_shift"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true
	},
	{
		key: "blade_fury",
		isItem: false,
		names: ["juggernaut_blade_fury"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true
	},
	{
		key: "rage",
		isItem: false,
		names: ["life_stealer_rage"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true
	},
	{
		key: "shadow_realm",
		isItem: false,
		names: ["dark_willow_shadow_realm"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true
	},
	{
		key: "aphotic_shield",
		isItem: false,
		names: ["abaddon_aphotic_shield"],
		mode: CastMode.Self,
		vsProjectile: true,
		vsCast: true
	}
]

export class CounterSlot {
	public enabled = true
	public ability: Nullable<Ability>

	constructor(public readonly def: CounterDef) {}

	public get IsFound(): boolean {
		return this.ability !== undefined && this.ability.IsValid
	}

	public get IsShown(): boolean {
		return this.def.isItem || this.IsFound
	}

	public get Texture(): string {
		const abil = this.ability
		const name = abil !== undefined && abil.IsValid ? abil.Name : this.def.names[0]
		return this.def.isItem ? ImageData.GetItemTexture(name) : ImageData.GetSpellTexture(name)
	}

	public Matches(isProjectile: boolean): boolean {
		return isProjectile ? this.def.vsProjectile : this.def.vsCast
	}

	public CanUse(hero: Hero): boolean {
		const abil = this.ability
		if (!this.enabled || abil === undefined || !abil.IsValid || !abil.CanBeCasted()) {
			return false
		}
		return this.def.isItem ? !hero.IsMuted : !hero.IsSilenced
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

export function CreateSlots(): CounterSlot[] {
	return [...ITEM_DEFS, ...ABILITY_DEFS].map(def => new CounterSlot(def))
}
