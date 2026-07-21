import {
	Ability,
	Color,
	DOTAGameState,
	DOTAGameUIState,
	earth_spirit_boulder_smash,
	earth_spirit_geomagnetic_grip,
	earth_spirit_magnetize,
	earth_spirit_rolling_boulder,
	earth_spirit_stone_caller,
	EarthSpiritStone,
	EntityManager,
	EventsSDK,
	GameRules,
	GameState,
	Hero,
	InputManager,
	LocalPlayer,
	npc_dota_hero_earth_spirit,
	ParticlesSDK,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { EarthSpiritMenu } from "./menu"

const MAGNETIZE_MODIFIER = "modifier_earth_spirit_magnetize"
const PETRIFY_ABILITY = "earth_spirit_petrify"
const CAST_GAP = 0.25
const ATTACK_GAP = 0.3
const STONE_NEAR_RADIUS = 220
const GRIP_STONE_BEHIND = 150
const ROLL_PLACE_DISTANCE = 250
const ROLL_SPEED_FALLBACK = 1600
const RANGE_BUFFER = 100
const TARGET_RING_KEY = "heroes_combo_target"
const TARGET_RING_COLOR = new Color(80, 220, 120)

export class ComboManager {
	private readonly particles = new ParticlesSDK()
	private nextCastTime = 0
	private lastAttackTime = 0

	constructor(private readonly menu: EarthSpiritMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<npc_dota_hero_earth_spirit> {
		const hero = LocalPlayer?.Hero
		if (!(hero instanceof npc_dota_hero_earth_spirit)) {
			return undefined
		}
		if (!hero.IsValid || !hero.IsAlive) {
			return undefined
		}
		return hero
	}

	private get InGame(): boolean {
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return false
		}
		return GameRules?.GameState === DOTAGameState.DOTA_GAMERULES_STATE_GAME_IN_PROGRESS
	}

	private PostDataUpdate(): void {
		const hero = this.Hero
		if (!this.menu.State.value || !this.menu.ComboKey.isPressed || !this.InGame || hero === undefined) {
			this.ClearTarget()
			return
		}
		const enemy = this.FindEnemy()
		this.DrawTarget(enemy)
		if (hero.IsStunned || enemy === undefined) {
			return
		}
		if (GameState.RawGameTime < this.nextCastTime) {
			return
		}
		this.Execute(hero, enemy)
	}

	private Execute(hero: npc_dota_hero_earth_spirit, enemy: Hero): void {
		const stone = hero.GetAbilityByClass(earth_spirit_stone_caller)
		const grip = hero.GetAbilityByClass(earth_spirit_geomagnetic_grip)
		const rolling = hero.GetAbilityByClass(earth_spirit_rolling_boulder)
		const smash = hero.GetAbilityByClass(earth_spirit_boulder_smash)
		const magnetize = hero.GetAbilityByClass(earth_spirit_magnetize)
		const petrify = hero.GetAbilityByName(PETRIFY_ABILITY)

		if (this.Enabled("earth_spirit_geomagnetic_grip") && this.Ready(grip) && this.InRange(hero, grip!, enemy)) {
			const behind = hero.Position.Extend(enemy.Position, hero.Distance2D(enemy) + GRIP_STONE_BEHIND)
			if (!this.HasStoneNear(behind, STONE_NEAR_RADIUS)) {
				if (this.PlaceStone(hero, stone, behind)) {
					return
				}
			} else {
				this.Cast(hero, grip!, enemy.Position)
				return
			}
		}

		if (
			this.Enabled("earth_spirit_rolling_boulder") &&
			this.Ready(rolling) &&
			this.InRange(hero, rolling!, enemy)
		) {
			const aim = this.PredictRoll(hero, rolling!, enemy)
			const rollStone = hero.Position.Extend(aim, ROLL_PLACE_DISTANCE)
			if (!this.HasStoneNear(rollStone, STONE_NEAR_RADIUS)) {
				if (this.PlaceStone(hero, stone, rollStone)) {
					return
				}
			} else {
				this.Cast(hero, rolling!, aim)
				return
			}
		}

		if (this.Enabled("earth_spirit_boulder_smash") && this.Ready(smash) && this.InRange(hero, smash!, enemy)) {
			if (!this.HasStoneNear(hero.Position, STONE_NEAR_RADIUS)) {
				if (this.PlaceStone(hero, stone, hero.Position)) {
					return
				}
			} else {
				this.Cast(hero, smash!, enemy.Position)
				return
			}
		}

		if (
			this.Enabled("earth_spirit_magnetize") &&
			this.Ready(magnetize) &&
			!enemy.HasBuffByName(MAGNETIZE_MODIFIER) &&
			this.InRange(hero, magnetize!, enemy)
		) {
			this.Cast(hero, magnetize!, enemy.Position)
			return
		}

		if (
			this.Enabled(PETRIFY_ABILITY) &&
			petrify !== undefined &&
			this.Ready(petrify) &&
			this.InRange(hero, petrify, enemy)
		) {
			hero.CastTarget(petrify, enemy)
			this.nextCastTime = GameState.RawGameTime + CAST_GAP
			return
		}

		this.Attack(hero, enemy)
	}

	private Attack(hero: npc_dota_hero_earth_spirit, enemy: Hero): void {
		const now = GameState.RawGameTime
		if (now - this.lastAttackTime < ATTACK_GAP) {
			return
		}
		this.lastAttackTime = now
		hero.AttackTarget(enemy)
	}

	private PredictRoll(hero: npc_dota_hero_earth_spirit, rolling: earth_spirit_rolling_boulder, enemy: Hero): Vector3 {
		if (!enemy.IsMoving) {
			return enemy.Position
		}
		const speed = rolling.GetBaseSpeedForLevel(rolling.Level) || ROLL_SPEED_FALLBACK
		const delay = hero.Distance2D(enemy) / speed + rolling.GetBaseActivationDelayForLevel(rolling.Level)
		return enemy.VelocityWaypoint(delay)
	}

	private FindEnemy(): Nullable<Hero> {
		const cursor = InputManager.CursorOnWorld
		let target: Nullable<Hero>
		let closest = Number.MAX_VALUE
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || !enemy.IsEnemy()) {
				continue
			}
			if (enemy.IsIllusion) {
				continue
			}
			const distance = enemy.Distance2D(cursor)
			if (distance >= closest) {
				continue
			}
			closest = distance
			target = enemy
		}
		return target
	}

	private Enabled(name: string): boolean {
		return this.menu.ComboAbilities.IsEnabled(name)
	}

	private Ready(ability: Nullable<Ability>): boolean {
		return ability !== undefined && ability.Level > 0 && ability.CanBeCasted()
	}

	private InRange(hero: npc_dota_hero_earth_spirit, ability: Ability, enemy: Hero): boolean {
		const range = ability.CastRange
		return range <= 0 || hero.Distance2D(enemy) <= range + RANGE_BUFFER
	}

	private PlaceStone(
		hero: npc_dota_hero_earth_spirit,
		stone: Nullable<earth_spirit_stone_caller>,
		position: Vector3
	): boolean {
		if (
			!this.Enabled("earth_spirit_stone_caller") ||
			stone === undefined ||
			!stone.CanBeUsable ||
			stone.CurrentCharges <= 0
		) {
			return false
		}
		hero.CastPosition(stone, this.ClampToRange(hero, position, stone.CastRange))
		this.nextCastTime = GameState.RawGameTime + CAST_GAP
		return true
	}

	private Cast(hero: npc_dota_hero_earth_spirit, ability: Ability, position: Vector3): void {
		hero.CastPosition(ability, this.ClampToRange(hero, position, ability.CastRange))
		this.nextCastTime = GameState.RawGameTime + CAST_GAP
	}

	private HasStoneNear(position: Vector3, radius: number): boolean {
		return EntityManager.GetEntitiesByClass(EarthSpiritStone).some(
			stone => stone.IsValid && stone.IsAlive && !stone.IsEnemy() && stone.Distance2D(position) <= radius
		)
	}

	private ClampToRange(hero: npc_dota_hero_earth_spirit, position: Vector3, range: number): Vector3 {
		if (range <= 0 || hero.Distance2D(position) <= range) {
			return position.Clone()
		}
		return hero.Position.Extend(position, range)
	}

	private DrawTarget(enemy: Nullable<Hero>): void {
		if (enemy === undefined) {
			this.ClearTarget()
			return
		}
		this.particles.DrawSelectedRing(TARGET_RING_KEY, enemy, enemy.HullRadius + 40, enemy, TARGET_RING_COLOR)
	}

	private ClearTarget(): void {
		this.particles.DestroyByKey(TARGET_RING_KEY)
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.nextCastTime = 0
		this.lastAttackTime = 0
		this.ClearTarget()
	}
}
