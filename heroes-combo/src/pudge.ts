import {
	Ability,
	Color,
	DOTA_ABILITY_BEHAVIOR,
	DOTA_UNIT_TARGET_TEAM,
	DOTAGameState,
	DOTAGameUIState,
	EntityManager,
	EventsSDK,
	ExecuteOrder,
	GameRules,
	GameState,
	Hero,
	InputManager,
	LifeState,
	LocalPlayer,
	Modifier,
	ParticlesSDK,
	pudge_meat_hook,
	pudge_rot,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { PudgeMenu } from "./pudge-menu"

const PUDGE_NAME = "npc_dota_hero_pudge"
const HOOK = "pudge_meat_hook"
const ROT = "pudge_rot"
const FLESH_HEAP = "pudge_flesh_heap"
const DISMEMBER = "pudge_dismember"

const HOOK_MODIFIER = "modifier_pudge_meat_hook"
const ROT_MODIFIER = "modifier_pudge_rot"
const DISMEMBER_MODIFIER = "modifier_pudge_dismember"
const LINKEN_MODIFIER = "modifier_item_sphere_target"

const HOOK_SPEED_FALLBACK = 1600
const HOOK_RANGE_FALLBACK = 1000
const ROT_RADIUS_FALLBACK = 250
const DISMEMBER_RANGE_FALLBACK = 175
const HEAP_RANGE = 500

const PREDICTION_PASSES = 3
const COMBO_HOLD_TIME = 3
const HOOK_DRAG_MAX = 2
const ROT_HYSTERESIS = 1.2
const ROT_ORDER_GUARD = 0.3
const ORDER_GUARD = 0.03
const ATTACK_GAP = 0.1

const TARGET_LINE_KEY = "heroes_combo_pudge_target"
const TARGET_LINE_COLOR = new Color(255, 40, 40)

export class PudgeCombo {
	private readonly particles = new ParticlesSDK()
	private pendingAbility: Nullable<Ability>
	private pendingTime = 0
	private lastAttackTime = 0
	private comboUntil = 0
	private comboHeld = false
	private rotOrderTime = 0
	private rotOrderWant = false
	private hookVictim: Nullable<Hero>
	private hookVictimUntil = 0

	constructor(private readonly menu: PudgeMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("ModifierCreated", this.ModifierCreated.bind(this))
		EventsSDK.on("PrepareUnitOrders", this.PrepareUnitOrders.bind(this))
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
		this.hookVictimUntil = GameState.RawGameTime + HOOK_DRAG_MAX
		if (this.menu.ComboAfterHook.value) {
			this.comboUntil = GameState.RawGameTime + COMBO_HOLD_TIME
		}
	}

	private PrepareUnitOrders(order: ExecuteOrder): boolean {
		if (!order.IsPlayerInput || this.comboUntil === 0) {
			return true
		}
		const hero = this.Hero
		if (hero !== undefined && order.Issuers.includes(hero)) {
			this.comboUntil = 0
		}
		return true
	}

	private PostDataUpdate(): void {
		const hero = this.Hero
		if (!this.menu.State.value || !this.InGame || hero === undefined) {
			this.Reset()
			return
		}
		this.UpdateHookVictim()
		if (this.menu.AutoRot.value) {
			this.AutoRot(hero)
		}
		if (!this.ComboActive()) {
			this.ClearTarget()
			return
		}
		if (hero.IsChanneling) {
			return
		}
		const enemy = this.hookVictim ?? this.FindEnemy()
		this.DrawTarget(hero, enemy)
		if (hero.IsStunned || enemy === undefined || !this.CanAct()) {
			return
		}
		this.Execute(hero, enemy)
	}

	private ComboActive(): boolean {
		const held = this.menu.ComboKey.isPressed
		if (this.comboHeld && !held) {
			this.comboUntil = 0
		}
		this.comboHeld = held
		return held || GameState.RawGameTime < this.comboUntil
	}

	private UpdateHookVictim(): void {
		const victim = this.hookVictim
		if (victim === undefined) {
			return
		}
		if (GameState.RawGameTime > this.hookVictimUntil) {
			this.hookVictim = undefined
			return
		}
		if (!this.IsValidTarget(victim) || !victim.HasBuffByName(HOOK_MODIFIER)) {
			this.hookVictim = undefined
		}
	}

	private Execute(hero: Hero, enemy: Hero): void {
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		const rot = hero.GetAbilityByClass(pudge_rot)
		const heap = hero.GetAbilityByName(FLESH_HEAP)
		const dismember = hero.GetAbilityByName(DISMEMBER)
		const distance = hero.Distance2D(enemy)
		const dragged = enemy === this.hookVictim

		if (dragged && this.InstantDismember(hero, dismember, enemy, distance)) {
			return
		}
		if (!dragged && this.Enabled(HOOK) && this.Ready(hook) && this.ThrowHook(hero, hook!, enemy)) {
			return
		}
		if (this.Enabled(ROT) && rot !== undefined && this.SetRot(hero, rot, this.RotWanted(hero, rot, distance))) {
			return
		}
		if (this.Enabled(FLESH_HEAP) && this.CastHeap(hero, heap, distance)) {
			return
		}
		if (
			this.Enabled(DISMEMBER) &&
			this.Castable(dismember, enemy) &&
			distance <= this.AbilityRange(dismember!, DISMEMBER_RANGE_FALLBACK)
		) {
			hero.CastTarget(dismember!, enemy)
			this.LockCast(dismember!)
			return
		}
		if (dragged) {
			return
		}
		this.Attack(hero, enemy)
	}

	private InstantDismember(hero: Hero, dismember: Nullable<Ability>, victim: Hero, distance: number): boolean {
		if (!this.Enabled(DISMEMBER) || !this.Castable(dismember, victim)) {
			return false
		}
		const range = this.AbilityRange(dismember!, DISMEMBER_RANGE_FALLBACK)
		if (distance > range + this.DragLead(hero, dismember!)) {
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

	private ThrowHook(hero: Hero, hook: pudge_meat_hook, enemy: Hero): boolean {
		if (enemy.IsInvulnerable || enemy.IsUntargetable) {
			return false
		}
		const range = this.AbilityRange(hook, HOOK_RANGE_FALLBACK)
		if (hero.Distance2D(enemy) > range) {
			return false
		}
		const point = this.HookPoint(hero, hook, enemy)
		if (hero.Distance2D(point) > range) {
			return false
		}
		hero.CastPosition(hook, point)
		this.LockCast(hook)
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

	private CastHeap(hero: Hero, heap: Nullable<Ability>, distance: number): boolean {
		if (distance > HEAP_RANGE || !this.Ready(heap)) {
			return false
		}
		if (heap!.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_PASSIVE)) {
			return false
		}
		if (heap!.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_TOGGLE)) {
			if (heap!.IsToggled) {
				return false
			}
			hero.CastToggle(heap!)
		} else if (heap!.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET)) {
			hero.CastTarget(heap!, hero)
		} else if (heap!.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)) {
			hero.CastPosition(heap!, hero.Position)
		} else {
			hero.CastNoTarget(heap!)
		}
		this.LockCast(heap!)
		return true
	}

	private AutoRot(hero: Hero): void {
		const rot = hero.GetAbilityByClass(pudge_rot)
		if (rot === undefined || rot.Level === 0) {
			return
		}
		if (this.hookVictim !== undefined || this.Dismembering(hero)) {
			this.SetRot(hero, rot, true)
			return
		}
		if (!hero.HasBuffByName(ROT_MODIFIER)) {
			return
		}
		const nearest = this.NearestEnemy(hero)
		const distance = nearest === undefined ? Number.MAX_VALUE : hero.Distance2D(nearest)
		this.SetRot(hero, rot, this.RotWanted(hero, rot, distance))
	}

	private Dismembering(hero: Hero): boolean {
		if (hero.HasBuffByName(DISMEMBER_MODIFIER)) {
			return true
		}
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
		if (rot.Level === 0 || hero.IsStunned || want === hero.HasBuffByName(ROT_MODIFIER)) {
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

	private Attack(hero: Hero, enemy: Hero): void {
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

	private Castable(ability: Nullable<Ability>, enemy: Hero): boolean {
		if (!this.Ready(ability)) {
			return false
		}
		if (enemy.IsMagicImmune || enemy.IsInvulnerable || enemy.IsUntargetable) {
			return false
		}
		if (!enemy.HasBuffByName(LINKEN_MODIFIER)) {
			return true
		}
		return !ability!.TargetTeamMask.hasMask(DOTA_UNIT_TARGET_TEAM.DOTA_UNIT_TARGET_TEAM_ENEMY)
	}

	private AbilityRange(ability: Ability, fallback: number): number {
		return ability.CastRange > 0 ? ability.CastRange : fallback
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
		this.lastAttackTime = GameState.RawGameTime
	}

	private DrawTarget(hero: Hero, enemy: Nullable<Hero>): void {
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
		this.comboUntil = 0
		this.comboHeld = false
		this.rotOrderTime = 0
		this.rotOrderWant = false
		this.hookVictim = undefined
		this.hookVictimUntil = 0
		this.ClearTarget()
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.Reset()
	}
}
