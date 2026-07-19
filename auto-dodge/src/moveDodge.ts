import {
	dotaunitorder_t,
	EntityManager,
	EventsSDK,
	ExecuteOrder,
	GameState,
	Hero,
	ImageData,
	LinearProjectile,
	ProjectileManager,
	Sleeper,
	Thinker,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

const DODGE_MARGIN = 50
const MOVE_SLEEP_MS = 150
const LINEAR_AHEAD_DIST = 2000
const BLOCK_DURATION = 0.4

const enum SpellType {
	Linear,
	AOE
}

export interface SpellDef {
	readonly name: string
	readonly type: SpellType
	readonly width: number
}

const LINEAR_SPELLS: SpellDef[] = [
	{ name: "clinkz_burning_barrage", type: SpellType.Linear, width: 175 },
	{ name: "dragon_knight_breathe_fire", type: SpellType.Linear, width: 300 },
	{ name: "drow_ranger_wave_of_silence", type: SpellType.Linear, width: 250 },
	{ name: "earth_spirit_rolling_boulder", type: SpellType.Linear, width: 150 },
	{ name: "grimstroke_stroke_of_fate", type: SpellType.Linear, width: 200 },
	{ name: "invoker_deafening_blast", type: SpellType.Linear, width: 225 },
	{ name: "invoker_tornado", type: SpellType.Linear, width: 200 },
	{ name: "kunkka_ghostship", type: SpellType.Linear, width: 425 },
	{ name: "lina_dragon_slave", type: SpellType.Linear, width: 275 },
	{ name: "lion_impale", type: SpellType.Linear, width: 140 },
	{ name: "mars_spear_of_mars", type: SpellType.Linear, width: 140 },
	{ name: "mirana_arrow", type: SpellType.Linear, width: 115 },
	{ name: "morphling_waveform", type: SpellType.Linear, width: 200 },
	{ name: "nyx_assassin_impale", type: SpellType.Linear, width: 140 },
	{ name: "pangolier_swashbuckle", type: SpellType.Linear, width: 200 },
	{ name: "sandking_burrowstrike", type: SpellType.Linear, width: 150 },
	{ name: "shadow_demon_shadow_poison", type: SpellType.Linear, width: 200 },
	{ name: "shredder_chakram", type: SpellType.Linear, width: 200 },
	{ name: "venomancer_venomous_gale", type: SpellType.Linear, width: 200 },
	{ name: "windrunner_powershot", type: SpellType.Linear, width: 125 },
	{ name: "hoodwink_sharpshooter", type: SpellType.Linear, width: 125 },
	{ name: "hoodwink_hunters_boomerang", type: SpellType.Linear, width: 200 },
	{ name: "jakiro_ice_path", type: SpellType.Linear, width: 200 },
	{ name: "magnataur_shockwave", type: SpellType.Linear, width: 200 },
	{ name: "monkey_king_boundless_strike", type: SpellType.Linear, width: 200 },
	{ name: "snapfire_scatterblast", type: SpellType.Linear, width: 300 },
	{ name: "snapfire_firesnap_cookie", type: SpellType.Linear, width: 200 }
]

const AOE_SPELLS: SpellDef[] = [
	{ name: "bloodseeker_blood_rite", type: SpellType.AOE, width: 600 },
	{ name: "death_prophet_silence", type: SpellType.AOE, width: 425 },
	{ name: "invoker_sun_strike", type: SpellType.AOE, width: 175 },
	{ name: "kunkka_torrent", type: SpellType.AOE, width: 250 },
	{ name: "leshrac_split_earth", type: SpellType.AOE, width: 150 },
	{ name: "lina_light_strike_array", type: SpellType.AOE, width: 250 },
	{ name: "nevermore_shadowraze1", type: SpellType.AOE, width: 250 },
	{ name: "nevermore_shadowraze2", type: SpellType.AOE, width: 250 },
	{ name: "nevermore_shadowraze3", type: SpellType.AOE, width: 250 },
	{ name: "tiny_avalanche", type: SpellType.AOE, width: 325 },
	{ name: "tidehunter_ravage", type: SpellType.AOE, width: 1250 },
	{ name: "faceless_void_chronosphere", type: SpellType.AOE, width: 500 },
	{ name: "dawnbreaker_solar_guardian", type: SpellType.AOE, width: 500 },
	{ name: "ancient_apparition_ice_blast", type: SpellType.AOE, width: 400 }
]

const ALL_SPELLS = [...LINEAR_SPELLS, ...AOE_SPELLS]

const SHADOWRAZE_DIST: ReadonlyMap<string, number> = new Map([
	["nevermore_shadowraze1", 200],
	["nevermore_shadowraze2", 450],
	["nevermore_shadowraze3", 700]
])

export interface MoveDodgeSlot {
	readonly def: SpellDef
	enabled: boolean
}

export function CreateMoveDodgeSlots(): MoveDodgeSlot[] {
	return ALL_SPELLS.map(def => ({ def, enabled: true }))
}

export function GetSlotTexture(slot: MoveDodgeSlot): string {
	return ImageData.GetSpellTexture(slot.def.name)
}

export class MoveDodge {
	public moveDodgeEnabled = true
	public blockControl = false
	private readonly sleeper = new Sleeper()
	private blockingUntil = 0
	private lastDodgeName = ""
	private readonly nameMap: Map<string, MoveDodgeSlot>

	constructor(slots: MoveDodgeSlot[]) {
		this.nameMap = new Map(slots.map(s => [s.def.name, s]))
		EventsSDK.on("PrepareUnitOrders", order => this.OnPrepareOrder(order))
	}

	public get Status(): string {
		if (!this.moveDodgeEnabled) {
			return "move:off"
		}
		if (this.sleeper.Sleeping("move")) {
			return `move:dodge(${this.lastDodgeName})`
		}
		return "move:watch"
	}

	public Tick(hero: Hero): void {
		if (!this.moveDodgeEnabled || !hero.IsAlive) {
			return
		}
		if (hero.IsStunned || hero.IsHexed || hero.IsRooted) {
			return
		}
		if (this.sleeper.Sleeping("move")) {
			return
		}

		const heroPos = hero.Position
		const hull = hero.HullRadius

		const dodge =
			this.CheckLinear(hero, heroPos, hull) ??
			this.CheckThinkerAOE(hero, heroPos, hull) ??
			this.CheckCastPhaseAOE(hero, heroPos, hull)

		if (dodge === undefined) {
			return
		}

		hero.MoveTo(dodge.target, false, false)
		this.sleeper.Sleep(MOVE_SLEEP_MS, "move")
		this.lastDodgeName = dodge.name
		if (this.blockControl) {
			this.blockingUntil = GameState.RawGameTime + BLOCK_DURATION
		}
	}

	public Reset(): void {
		this.sleeper.FullReset()
		this.blockingUntil = 0
		this.lastDodgeName = ""
	}

	private CheckLinear(hero: Hero, heroPos: Vector3, hull: number): Nullable<{ target: Vector3; name: string }> {
		for (const proj of ProjectileManager.AllLinearProjectiles) {
			if (!proj.IsValid) {
				continue
			}
			const source = proj.Source
			if (!(source instanceof Unit) || !source.IsEnemy(hero)) {
				continue
			}
			const abilName = proj.Ability?.Name
			if (abilName === undefined) {
				continue
			}
			const slot = this.nameMap.get(abilName)
			if (slot === undefined || !slot.enabled) {
				continue
			}

			const target = this.LinearDodgeTarget(proj, heroPos, hull, slot.def.width)
			if (target !== undefined) {
				return { target, name: abilName }
			}
		}
		return undefined
	}

	private LinearDodgeTarget(
		proj: LinearProjectile,
		heroPos: Vector3,
		hull: number,
		width: number
	): Nullable<Vector3> {
		const fwd = proj.Forward
		const origin = proj.Position
		const dx = heroPos.x - origin.x
		const dy = heroPos.y - origin.y
		const along = dx * fwd.x + dy * fwd.y
		if (along < 0 || along > LINEAR_AHEAD_DIST) {
			return undefined
		}

		const cross = dx * fwd.y - dy * fwd.x
		const perpDist = Math.abs(cross)
		const dangerW = width + hull + DODGE_MARGIN
		if (perpDist >= dangerW) {
			return undefined
		}

		const moveAmt = dangerW - perpDist + DODGE_MARGIN
		const sign = cross >= 0 ? 1 : -1
		return new Vector3(heroPos.x + -fwd.y * sign * moveAmt, heroPos.y + fwd.x * sign * moveAmt, heroPos.z)
	}

	private CheckThinkerAOE(hero: Hero, heroPos: Vector3, hull: number): Nullable<{ target: Vector3; name: string }> {
		for (const thinker of EntityManager.GetEntitiesByClass(Thinker)) {
			if (!thinker.IsValid || !thinker.IsAlive) {
				continue
			}
			for (const buff of thinker.Buffs) {
				const caster = buff.Caster
				if (caster === undefined || !(caster instanceof Unit) || !caster.IsEnemy(hero)) {
					continue
				}
				const abilName = buff.Ability?.Name
				if (abilName === undefined) {
					continue
				}
				const slot = this.nameMap.get(abilName)
				if (slot === undefined || !slot.enabled || slot.def.type !== SpellType.AOE) {
					continue
				}

				const target = this.AOEDodgeTarget(thinker.Position, heroPos, hull, slot.def.width)
				if (target !== undefined) {
					return { target, name: abilName }
				}
			}
		}
		return undefined
	}

	private CheckCastPhaseAOE(hero: Hero, heroPos: Vector3, hull: number): Nullable<{ target: Vector3; name: string }> {
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion || !enemy.IsEnemy(hero)) {
				continue
			}
			for (const spell of enemy.Spells) {
				if (spell === undefined || !spell.IsValid || !spell.IsInAbilityPhase) {
					continue
				}
				const name = spell.Name
				const razeDist = SHADOWRAZE_DIST.get(name)
				if (razeDist !== undefined) {
					const slot = this.nameMap.get(name)
					if (slot === undefined || !slot.enabled) {
						continue
					}
					const angle = enemy.RotationRad
					const center = new Vector3(
						enemy.Position.x + Math.cos(angle) * razeDist,
						enemy.Position.y + Math.sin(angle) * razeDist,
						enemy.Position.z
					)
					const target = this.AOEDodgeTarget(center, heroPos, hull, slot.def.width)
					if (target !== undefined) {
						return { target, name }
					}
				}
				if (name === "tidehunter_ravage") {
					const slot = this.nameMap.get(name)
					if (slot === undefined || !slot.enabled) {
						continue
					}
					const target = this.AOEDodgeTarget(enemy.Position, heroPos, hull, slot.def.width)
					if (target !== undefined) {
						return { target, name }
					}
				}
			}
		}
		return undefined
	}

	private AOEDodgeTarget(center: Vector3, heroPos: Vector3, hull: number, radius: number): Nullable<Vector3> {
		const dist = center.Distance2D(heroPos)
		const dangerR = radius + hull
		if (dist >= dangerR) {
			return undefined
		}

		const dx = heroPos.x - center.x
		const dy = heroPos.y - center.y
		const len = Math.sqrt(dx * dx + dy * dy)
		if (len < 1) {
			return new Vector3(heroPos.x + dangerR + DODGE_MARGIN, heroPos.y, heroPos.z)
		}
		const moveAmt = dangerR - dist + DODGE_MARGIN
		return new Vector3(heroPos.x + (dx / len) * moveAmt, heroPos.y + (dy / len) * moveAmt, heroPos.z)
	}

	private OnPrepareOrder(order: ExecuteOrder): false | undefined {
		if (!this.blockControl || !this.moveDodgeEnabled) {
			return undefined
		}
		if (GameState.RawGameTime > this.blockingUntil) {
			return undefined
		}
		if (!order.IsPlayerInput) {
			return undefined
		}
		switch (order.OrderType) {
			case dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_POSITION:
			case dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_DIRECTION:
			case dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_TARGET:
			case dotaunitorder_t.DOTA_UNIT_ORDER_ATTACK_MOVE:
			case dotaunitorder_t.DOTA_UNIT_ORDER_ATTACK_TARGET:
			case dotaunitorder_t.DOTA_UNIT_ORDER_HOLD_POSITION:
			case dotaunitorder_t.DOTA_UNIT_ORDER_STOP:
				return false
		}
		return undefined
	}
}
