import {
	Ability,
	Color,
	DOTA_ABILITY_BEHAVIOR,
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
	LifeState,
	LocalPlayer,
	npc_dota_hero_earth_spirit,
	ParticlesSDK,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { EarthSpiritMenu } from "./menu"

const MAGNETIZE_MODIFIER = "modifier_earth_spirit_magnetize"
const PETRIFY_ABILITY = "earth_spirit_petrify"
const ORDER_GUARD = 0.03
const ATTACK_GAP = 0.1
const STONE_NEAR_RADIUS = 220
const GRIP_STONE_BEHIND = 150
const ROLL_PLACE_DISTANCE = 250
const ROLL_CLOSE_RANGE = 300
const ROLL_SPEED_FALLBACK = 1600
const TARGET_LINE_KEY = "heroes_combo_target_line"
const TARGET_LINE_COLOR = new Color(255, 40, 40)

export class ComboManager {
	private readonly particles = new ParticlesSDK()
	private pendingAbility: Nullable<Ability>
	private pendingTime = 0
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
			this.Reset()
			return
		}
		const enemy = this.FindEnemy()
		this.DrawTarget(hero, enemy)
		if (hero.IsStunned || enemy === undefined || !this.CanAct()) {
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

		const distance = hero.Distance2D(enemy)
		if (distance > this.EngageRange(hero, stone, grip, rolling, smash, magnetize, petrify)) {
			this.Attack(hero, enemy)
			return
		}

		if (this.Enabled("earth_spirit_geomagnetic_grip") && this.Ready(grip) && this.InRange(hero, grip!, enemy)) {
			const behind = hero.Position.Extend(enemy.Position, hero.Distance2D(enemy) + GRIP_STONE_BEHIND)
			const stonePosition = this.StonePosition(hero, stone, behind)
			if (this.HasStoneNear(stonePosition, STONE_NEAR_RADIUS)) {
				this.Cast(hero, grip!, enemy.Position)
				return
			}
			if (this.PlaceStone(hero, stone, stonePosition)) {
				return
			}
		}

		if (
			this.Enabled("earth_spirit_rolling_boulder") &&
			this.Ready(rolling) &&
			this.InRange(hero, rolling!, enemy)
		) {
			const aim = this.PredictRoll(hero, rolling!, enemy)
			if (hero.Distance2D(enemy) <= ROLL_CLOSE_RANGE) {
				this.Cast(hero, rolling!, aim)
				return
			}
			const stonePosition = this.StonePosition(hero, stone, hero.Position.Extend(aim, ROLL_PLACE_DISTANCE))
			if (this.HasStoneNear(stonePosition, STONE_NEAR_RADIUS)) {
				this.Cast(hero, rolling!, aim)
				return
			}
			if (this.PlaceStone(hero, stone, stonePosition)) {
				return
			}
			this.Cast(hero, rolling!, aim)
			return
		}

		if (this.Enabled("earth_spirit_boulder_smash") && this.Ready(smash) && this.InRange(hero, smash!, enemy)) {
			if (this.HasStoneNear(hero.Position, STONE_NEAR_RADIUS)) {
				this.Cast(hero, smash!, enemy.Position)
				return
			}
			if (this.PlaceStone(hero, stone, hero.Position)) {
				return
			}
		}

		if (
			this.Enabled("earth_spirit_magnetize") &&
			this.Ready(magnetize) &&
			!enemy.HasBuffByName(MAGNETIZE_MODIFIER) &&
			this.InRange(hero, magnetize!, enemy)
		) {
			this.CastAuto(hero, magnetize!, enemy)
			return
		}

		if (
			this.Enabled(PETRIFY_ABILITY) &&
			petrify !== undefined &&
			this.Ready(petrify) &&
			this.InRange(hero, petrify, enemy)
		) {
			this.CastAuto(hero, petrify, enemy)
			return
		}

		this.Attack(hero, enemy)
	}

	private Attack(hero: npc_dota_hero_earth_spirit, enemy: Hero): void {
		const now = GameState.RawGameTime
		if (now - this.lastAttackTime < ATTACK_GAP) {
			return
		}
		if (hero.IsAttacking && hero.Distance2D(enemy) <= hero.GetAttackRange(enemy)) {
			return
		}
		this.lastAttackTime = now
		hero.AttackTarget(enemy)
	}

	private CanAct(): boolean {
		const ability = this.pendingAbility
		if (ability === undefined) {
			return true
		}
		if (ability.IsValid && ability.IsInAbilityPhase) {
			return false
		}
		if (GameState.RawGameTime - this.pendingTime < GameState.InputLag + ORDER_GUARD) {
			return false
		}
		this.pendingAbility = undefined
		return true
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
			if (!this.IsValidTarget(enemy)) {
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

	private IsValidTarget(enemy: Hero): boolean {
		return (
			enemy.IsValid &&
			enemy.LifeState === LifeState.LIFE_ALIVE &&
			enemy.IsVisible &&
			enemy.IsEnemy() &&
			!enemy.IsIllusion
		)
	}

	private Enabled(name: string): boolean {
		return this.menu.ComboAbilities.IsEnabled(name)
	}

	private Ready(ability: Nullable<Ability>): boolean {
		return ability !== undefined && ability.Level > 0 && ability.CanBeCasted()
	}

	private InRange(hero: npc_dota_hero_earth_spirit, ability: Ability, enemy: Hero): boolean {
		const range = this.AbilityRange(ability)
		return range <= 0 || hero.Distance2D(enemy) <= range
	}

	private AbilityRange(ability: Ability): number {
		if (ability instanceof earth_spirit_rolling_boulder) {
			return this.RollDistance(ability)
		}
		const range = ability.CastRange
		if (range > 0) {
			return range
		}
		return ability.GetSpecialValue("radius")
	}

	private RollDistance(rolling: earth_spirit_rolling_boulder): number {
		const distance = rolling.GetSpecialValue("distance")
		if (distance > 0) {
			return distance
		}
		const speed = rolling.GetBaseSpeedForLevel(rolling.Level) || ROLL_SPEED_FALLBACK
		const duration = rolling.GetSpecialValue("duration")
		return duration > 0 ? speed * duration : speed
	}

	private GripRange(grip: earth_spirit_geomagnetic_grip, stone: Nullable<earth_spirit_stone_caller>): number {
		const stoneRange = (stone?.CastRange ?? 0) - GRIP_STONE_BEHIND
		return Math.min(this.AbilityRange(grip), Math.max(stoneRange, 0))
	}

	private EngageRange(
		hero: npc_dota_hero_earth_spirit,
		stone: Nullable<earth_spirit_stone_caller>,
		grip: Nullable<earth_spirit_geomagnetic_grip>,
		rolling: Nullable<earth_spirit_rolling_boulder>,
		smash: Nullable<earth_spirit_boulder_smash>,
		magnetize: Nullable<earth_spirit_magnetize>,
		petrify: Nullable<Ability>
	): number {
		let range = Number.MAX_VALUE
		if (this.Usable(grip, "earth_spirit_geomagnetic_grip")) {
			range = Math.min(range, this.GripRange(grip!, stone))
		}
		if (this.Usable(rolling, "earth_spirit_rolling_boulder")) {
			range = Math.min(range, this.AbilityRange(rolling!))
		}
		if (this.Usable(smash, "earth_spirit_boulder_smash")) {
			range = Math.min(range, this.AbilityRange(smash!))
		}
		if (this.Usable(magnetize, "earth_spirit_magnetize")) {
			range = Math.min(range, this.AbilityRange(magnetize!))
		}
		if (this.Usable(petrify, PETRIFY_ABILITY)) {
			range = Math.min(range, this.AbilityRange(petrify!))
		}
		return range === Number.MAX_VALUE ? hero.GetAttackRange() : range
	}

	private Usable(ability: Nullable<Ability>, name: string): boolean {
		return ability !== undefined && ability.Level > 0 && this.Enabled(name)
	}

	private CastAuto(hero: npc_dota_hero_earth_spirit, ability: Ability, enemy: Hero): void {
		if (ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_NO_TARGET)) {
			hero.CastNoTarget(ability)
		} else if (ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET)) {
			hero.CastTarget(ability, enemy)
		} else {
			hero.CastPosition(ability, enemy.Position)
		}
		this.LockCast(ability)
	}

	private StonePosition(
		hero: npc_dota_hero_earth_spirit,
		stone: Nullable<earth_spirit_stone_caller>,
		position: Vector3
	): Vector3 {
		return this.ClampToRange(hero, position, stone?.CastRange ?? 0)
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
		hero.CastPosition(stone, position)
		this.LockCast(stone)
		return true
	}

	private Cast(hero: npc_dota_hero_earth_spirit, ability: Ability, position: Vector3): void {
		hero.CastPosition(ability, this.ClampToRange(hero, position, ability.CastRange))
		this.LockCast(ability)
	}

	private LockCast(ability: Ability): void {
		this.pendingAbility = ability
		this.pendingTime = GameState.RawGameTime
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

	private DrawTarget(hero: npc_dota_hero_earth_spirit, enemy: Nullable<Hero>): void {
		if (enemy === undefined) {
			this.ClearTarget()
			return
		}
		this.particles.DrawLineToTarget(TARGET_LINE_KEY, hero, enemy, TARGET_LINE_COLOR)
	}

	private ClearTarget(): void {
		this.particles.DestroyByKey(TARGET_LINE_KEY)
	}

	private Reset(): void {
		this.pendingAbility = undefined
		this.pendingTime = 0
		this.lastAttackTime = 0
		this.ClearTarget()
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.Reset()
	}
}
