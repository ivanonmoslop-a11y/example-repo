import {
	Ability,
	DOTA_ABILITY_BEHAVIOR,
	DOTA_UNIT_TARGET_TEAM,
	DOTAGameState,
	DOTAGameUIState,
	EntityManager,
	EventsSDK,
	GameRules,
	GameState,
	Hero,
	InputManager,
	LifeState,
	LocalPlayer,
	Modifier,
	pudge_meat_hook,
	pudge_rot,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { PudgeMenu } from "./pudge-menu"

const PUDGE_NAME = "npc_dota_hero_pudge"
const HOOK = "pudge_meat_hook"
const ROT = "pudge_rot"
const SHIELD = "pudge_meat_shield"
const DISMEMBER = "pudge_dismember"
const SHIELD_NAMES = ["pudge_meat_shield", "pudge_flesh_heap"]

const HOOK_MODIFIER = "modifier_pudge_meat_hook"
const ROT_MODIFIER = "modifier_pudge_rot"
const DISMEMBER_MODIFIER = "modifier_pudge_dismember"
const LINKEN_MODIFIER = "modifier_item_sphere_target"

const HOOK_SPEED_FALLBACK = 1600
const HOOK_RANGE_FALLBACK = 1000
const ROT_RADIUS_FALLBACK = 250
const DISMEMBER_RANGE_FALLBACK = 175
const SHIELD_RANGE = 500

const PREDICTION_PASSES = 3
const COMBO_HOLD_TIME = 3
const ROT_HYSTERESIS = 1.2
const ROT_ORDER_GUARD = 0.3
const ORDER_GUARD = 0.03
const ATTACK_GAP = 0.1

export class PudgeCombo {
	private pendingAbility: Nullable<Ability>
	private pendingTime = 0
	private lastOrderTime = 0
	private comboUntil = 0
	private rotOrderTime = 0
	private rotOrderWant = false
	private hookVictim: Nullable<Hero>

	constructor(private readonly menu: PudgeMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("ModifierCreated", this.ModifierCreated.bind(this))
		EventsSDK.on("ModifierRemoved", this.ModifierRemoved.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<Hero> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid || !hero.IsAlive) {
			return undefined
		}
		return hero.Name === PUDGE_NAME ? hero : undefined
	}

	private get InGame(): boolean {
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return false
		}
		return GameRules?.GameState === DOTAGameState.DOTA_GAMERULES_STATE_GAME_IN_PROGRESS
	}

	private ModifierCreated(modifier: Modifier): void {
		if (modifier.Name !== HOOK_MODIFIER || !this.menu.State.value) {
			return
		}
		const hero = this.Hero
		const victim = modifier.Parent
		if (hero === undefined || !(victim instanceof Hero) || !victim.IsEnemy()) {
			return
		}
		if (modifier.Caster !== undefined && modifier.Caster !== hero) {
			return
		}
		this.hookVictim = victim
		if (this.menu.ComboAfterHook.value) {
			this.comboUntil = GameState.RawGameTime + COMBO_HOLD_TIME
		}
	}

	private ModifierRemoved(modifier: Modifier): void {
		if (modifier.Name === HOOK_MODIFIER && modifier.Parent === this.hookVictim) {
			this.hookVictim = undefined
		}
	}

	private PostDataUpdate(): void {
		const hero = this.Hero
		if (!this.menu.State.value || !this.InGame || hero === undefined) {
			this.Reset()
			return
		}
		if (this.hookVictim !== undefined && !this.IsValidTarget(this.hookVictim)) {
			this.hookVictim = undefined
		}
		if (hero.IsChanneling) {
			return
		}
		if (hero.IsStunned || !this.CanAct()) {
			return
		}
		if (this.menu.AutoRot.value && this.AutoRot(hero)) {
			return
		}
		if (!this.ComboActive()) {
			return
		}
		if (this.InstantDismember(hero)) {
			return
		}
		if (this.hookVictim !== undefined) {
			return
		}
		const target = this.FindEnemy()
		if (target !== undefined) {
			this.Execute(hero, target)
		}
	}

	private ComboActive(): boolean {
		return this.menu.ComboKey.isPressed || GameState.RawGameTime < this.comboUntil
	}

	private InstantDismember(hero: Hero): boolean {
		const victim = this.hookVictim
		if (victim === undefined || !this.Enabled(DISMEMBER)) {
			return false
		}
		const dismember = hero.GetAbilityByName(DISMEMBER)
		if (!this.Castable(dismember, victim)) {
			return false
		}
		const range = dismember!.CastRange > 0 ? dismember!.CastRange : DISMEMBER_RANGE_FALLBACK
		if (hero.Distance2D(victim) > range + this.DragLead(hero, dismember!)) {
			return false
		}
		hero.CastTarget(dismember!, victim)
		this.LockCast(dismember!)
		return true
	}

	private DragLead(hero: Hero, dismember: Ability): number {
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		const speed =
			hook === undefined ? HOOK_SPEED_FALLBACK : hook.GetBaseSpeedForLevel(hook.Level) || HOOK_SPEED_FALLBACK
		return speed * dismember.CastDelay
	}

	private Execute(hero: Hero, target: Hero): void {
		const distance = hero.Distance2D(target)
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		const rot = hero.GetAbilityByClass(pudge_rot)
		const dismember = hero.GetAbilityByName(DISMEMBER)

		if (this.Enabled(HOOK) && hook !== undefined && this.Ready(hook)) {
			const range = hook.CastRange > 0 ? hook.CastRange : HOOK_RANGE_FALLBACK
			const point = this.HookPoint(hero, hook, target)
			if (distance <= range && hero.Distance2D(point) <= range && !target.IsInvulnerable) {
				hero.CastPosition(hook, point)
				this.LockCast(hook)
				return
			}
		}
		if (this.Enabled(ROT) && rot !== undefined && this.SetRot(hero, rot, this.RotWanted(hero, rot, distance))) {
			return
		}
		if (this.Enabled(SHIELD) && this.CastShield(hero, distance)) {
			return
		}
		if (this.Enabled(DISMEMBER) && this.Castable(dismember, target)) {
			const range = dismember!.CastRange > 0 ? dismember!.CastRange : DISMEMBER_RANGE_FALLBACK
			if (distance <= range) {
				hero.CastTarget(dismember!, target)
				this.LockCast(dismember!)
				return
			}
		}
		this.Attack(hero, target)
	}

	private CastShield(hero: Hero, distance: number): boolean {
		if (distance > SHIELD_RANGE) {
			return false
		}
		const shield = this.FindShield(hero)
		if (!this.Ready(shield)) {
			return false
		}
		if (shield!.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_PASSIVE)) {
			return false
		}
		if (shield!.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_TOGGLE)) {
			if (shield!.IsToggled) {
				return false
			}
			hero.CastToggle(shield!)
		} else if (shield!.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET)) {
			hero.CastTarget(shield!, hero)
		} else if (shield!.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)) {
			hero.CastPosition(shield!, hero.Position)
		} else {
			hero.CastNoTarget(shield!)
		}
		this.LockCast(shield!)
		return true
	}

	private FindShield(hero: Hero): Nullable<Ability> {
		for (const name of SHIELD_NAMES) {
			const ability = hero.GetAbilityByName(name)
			if (ability !== undefined) {
				return ability
			}
		}
		return undefined
	}

	private AutoRot(hero: Hero): boolean {
		const rot = hero.GetAbilityByClass(pudge_rot)
		if (rot === undefined || rot.Level === 0) {
			return false
		}
		if (this.hookVictim !== undefined || this.Dismembering(hero)) {
			return this.SetRot(hero, rot, true)
		}
		const target = this.NearestEnemy(hero)
		const distance = target === undefined ? Number.MAX_VALUE : hero.Distance2D(target)
		if (!hero.HasBuffByName(ROT_MODIFIER)) {
			return false
		}
		return this.SetRot(hero, rot, this.RotWanted(hero, rot, distance))
	}

	private Dismembering(hero: Hero): boolean {
		return EntityManager.GetEntitiesByClass(Hero).some(enemy => {
			const modifier = enemy.GetBuffByName(DISMEMBER_MODIFIER)
			return modifier !== undefined && modifier.Caster === hero
		})
	}

	private RotWanted(hero: Hero, rot: Ability, distance: number): boolean {
		const radius = rot.GetBaseAOERadiusForLevel(rot.Level) || ROT_RADIUS_FALLBACK
		const on = hero.HasBuffByName(ROT_MODIFIER)
		return distance <= (on ? radius * ROT_HYSTERESIS : radius)
	}

	private SetRot(hero: Hero, rot: Ability, want: boolean): boolean {
		if (rot.Level === 0 || want === hero.HasBuffByName(ROT_MODIFIER)) {
			return false
		}
		const now = GameState.RawGameTime
		if (this.rotOrderWant === want && now - this.rotOrderTime < ROT_ORDER_GUARD) {
			return false
		}
		this.rotOrderWant = want
		this.rotOrderTime = now
		hero.CastToggle(rot)
		this.LockCast(rot)
		return true
	}

	private HookPoint(hero: Hero, hook: pudge_meat_hook, target: Hero): Vector3 {
		const speed = hook.GetBaseSpeedForLevel(hook.Level) || HOOK_SPEED_FALLBACK
		let point = target.Position
		for (let i = 0; i < PREDICTION_PASSES; i++) {
			point = target.GetPredictionPosition(hook.CastDelay + hero.Distance2D(point) / speed, true)
		}
		return point
	}

	private Attack(hero: Hero, target: Hero): void {
		const now = GameState.RawGameTime
		if (now - this.lastOrderTime < ATTACK_GAP) {
			return
		}
		if (hero.IsAttacking && hero.Distance2D(target) <= hero.GetAttackRange(target)) {
			return
		}
		this.lastOrderTime = now
		hero.AttackTarget(target)
	}

	private Castable(ability: Nullable<Ability>, target: Hero): boolean {
		if (!this.Ready(ability)) {
			return false
		}
		if (target.IsMagicImmune || target.IsInvulnerable || target.IsUntargetable) {
			return false
		}
		if (target.HasBuffByName(LINKEN_MODIFIER)) {
			return ability!.TargetTeamMask.hasMask(DOTA_UNIT_TARGET_TEAM.DOTA_UNIT_TARGET_TEAM_ENEMY) === false
		}
		return true
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

	private NearestEnemy(hero: Hero): Nullable<Hero> {
		let target: Nullable<Hero>
		let closest = Number.MAX_VALUE
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!this.IsValidTarget(enemy)) {
				continue
			}
			const distance = hero.Distance2D(enemy)
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
		return this.menu.Abilities.IsEnabled(name)
	}

	private Ready(ability: Nullable<Ability>): boolean {
		return ability !== undefined && ability.Level > 0 && ability.CanBeCasted()
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

	private LockCast(ability: Ability): void {
		this.pendingAbility = ability
		this.pendingTime = GameState.RawGameTime
		this.lastOrderTime = GameState.RawGameTime
	}

	private Reset(): void {
		this.pendingAbility = undefined
		this.pendingTime = 0
		this.lastOrderTime = 0
		this.comboUntil = 0
		this.rotOrderTime = 0
		this.rotOrderWant = false
		this.hookVictim = undefined
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.Reset()
	}
}
