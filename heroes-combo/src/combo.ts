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
	RendererSDK,
	Vector2,
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
const ROLL_BASE_DISTANCE = 1500
const ROLL_HITBOX_RADIUS = 160
const ROLL_DISTANCE_SPECIALS = ["distance", "rock_distance", "roll_distance", "range"]
const STONE_RANGE_FALLBACK = 500
const TARGET_LINE_KEY = "heroes_combo_target_line"
const TARGET_LINE_COLOR = new Color(255, 40, 40)

export class ComboManager {
	private readonly particles = new ParticlesSDK()
	private pendingAbility: Nullable<Ability>
	private pendingTime = 0
	private lastAttackTime = 0

	constructor(private readonly menu: EarthSpiritMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("Draw", this.Draw.bind(this))
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

		if (this.Enabled("earth_spirit_geomagnetic_grip") && this.Ready(grip) && this.InRange(hero, grip!, enemy)) {
			const behind = hero.Position.Extend(enemy.Position, distance + GRIP_STONE_BEHIND)
			if (this.HasStoneNear(behind, STONE_NEAR_RADIUS)) {
				this.Cast(hero, grip!, enemy.Position)
				return
			}
			if (distance + GRIP_STONE_BEHIND <= this.StoneRange(stone) && this.PlaceStone(hero, stone, behind)) {
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
			const stonePosition = hero.Position.Extend(aim, ROLL_PLACE_DISTANCE)
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
		for (const name of ROLL_DISTANCE_SPECIALS) {
			const value = rolling.GetSpecialValue(name)
			if (value > 0) {
				return value + ROLL_HITBOX_RADIUS
			}
		}
		return ROLL_BASE_DISTANCE + ROLL_HITBOX_RADIUS
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

	private StoneRange(stone: Nullable<earth_spirit_stone_caller>): number {
		const range = stone?.CastRange ?? 0
		return range > 0 ? range : STONE_RANGE_FALLBACK
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

	private Draw(): void {
		if (!this.menu.State.value || !this.menu.ShowDebug.value || !this.menu.ComboKey.isPressed) {
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			return
		}
		const enemy = this.FindEnemy()
		const screen = RendererSDK.WorldToScreen(hero.RealPosition)
		if (screen === undefined) {
			return
		}
		const stone = hero.GetAbilityByClass(earth_spirit_stone_caller)
		const lines = [
			`dist ${enemy === undefined ? "-" : Math.round(hero.Distance2D(enemy))}`,
			`stone ${stone?.CurrentCharges ?? 0} r${Math.round(this.StoneRange(stone))}`,
			this.DebugAbility(hero, "grip", hero.GetAbilityByClass(earth_spirit_geomagnetic_grip)),
			this.DebugAbility(hero, "roll", hero.GetAbilityByClass(earth_spirit_rolling_boulder)),
			this.DebugAbility(hero, "smash", hero.GetAbilityByClass(earth_spirit_boulder_smash)),
			this.DebugAbility(hero, "ult", hero.GetAbilityByClass(earth_spirit_magnetize)),
			this.DebugAbility(hero, "petrify", hero.GetAbilityByName(PETRIFY_ABILITY))
		]
		for (let index = 0; index < lines.length; index++) {
			RendererSDK.Text(lines[index], screen.Add(new Vector2(0, index * 18)), Color.White)
		}
	}

	private DebugAbility(hero: npc_dota_hero_earth_spirit, name: string, ability: Nullable<Ability>): string {
		if (ability === undefined || ability.Level === 0) {
			return `${name} -`
		}
		const range = Math.round(this.AbilityRange(ability))
		const state = ability.CanBeCasted() ? "ok" : `cd${Math.round(ability.Cooldown)}`
		return `${name} r${range} ${state}`
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
