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

import { HookPredictor } from "./hook-predict"
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

const AUTO_HOOK_CHANCE = 0.8
const COMBO_HOOK_CHANCE = 0.3
const CANCEL_CHANCE = 0.45
const CANCEL_DEVIATION = 1.5
const HOOK_WATCH_GRACE = 0.5

const COMBO_HOLD_TIME = 3
const HOOK_DRAG_MAX = 2
const ROT_ORDER_GUARD = 0.3
const ORDER_GUARD = 0.03
const ATTACK_GAP = 0.1

const TARGET_LINE_KEY = "heroes_combo_pudge_target"
const TARGET_LINE_COLOR = new Color(255, 40, 40)

export class PudgeCombo {
	private readonly particles = new ParticlesSDK()
	private readonly predictor = new HookPredictor()
	private pendingAbility: Nullable<Ability>
	private pendingTime = 0
	private lastAttackTime = 0
	private comboUntil = 0
	private comboHeld = false
	private rotOrderTime = 0
	private hookVictim: Nullable<Hero>
	private hookVictimUntil = 0
	private hookOrderPoint: Nullable<Vector3>
	private hookOrderTarget: Nullable<Hero>
	private hookOrderTime = 0

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
		this.hookOrderPoint = undefined
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
		this.predictor.Update(hero)
		this.UpdateHookVictim()
		if (this.menu.AutoRot.value) {
			this.AutoRot(hero)
		}
		this.WatchHookCancel(hero)
		const combo = this.ComboActive()
		const aiming = this.menu.AutoHookKey.isPressed
		if (!combo && !aiming) {
			this.ClearTarget()
			return
		}
		const enemy = aiming ? this.AimTarget(hero) : this.hookVictim ?? this.FindEnemy()
		this.DrawTarget(hero, enemy)
		if (hero.IsChanneling || hero.IsStunned || !this.CanAct() || enemy === undefined) {
			return
		}
		if (aiming && this.AutoHook(hero, enemy)) {
			return
		}
		if (combo) {
			this.Execute(hero, aiming ? this.hookVictim ?? this.FindEnemy() ?? enemy : enemy)
		}
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

	// One deterministic aim target so the drawn line always names who Pudge is about to
	// hook: the enemy nearest the cursor, preferring one that is actually in hook range.
	private AimTarget(hero: Hero): Nullable<Hero> {
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		const range = hook === undefined ? HOOK_RANGE_FALLBACK : this.HookRange(hook)
		return this.FindEnemy(hero, range) ?? this.FindEnemy()
	}

	private HookRange(hook: pudge_meat_hook): number {
		return hook.CastRange > 0 ? hook.CastRange : HOOK_RANGE_FALLBACK
	}

	// Zero delay: the first tick a solution clears the bar, the hook goes out.
	private AutoHook(hero: Hero, target: Hero): boolean {
		if (!this.Enabled(HOOK) || target.IsInvulnerable || target.IsUntargetable) {
			return false
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (!this.Ready(hook)) {
			return false
		}
		const solution = this.predictor.Solve(hero, hook!, target)
		if (solution.blocked || solution.outOfRange || solution.chance < AUTO_HOOK_CHANCE) {
			return false
		}
		this.CastHook(hero, hook!, target, solution.point)
		return true
	}

	private Execute(hero: Hero, enemy: Hero): void {
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		const rot = hero.GetAbilityByClass(pudge_rot)
		const heap = hero.GetAbilityByName(FLESH_HEAP)
		const dismember = hero.GetAbilityByName(DISMEMBER)
		const distance = hero.Distance2D(enemy)
		const dragged = enemy === this.hookVictim

		if (dragged && this.InstantDismember(hero, dismember, enemy)) {
			return
		}
		if (!dragged && this.Enabled(HOOK) && this.Ready(hook) && this.ComboHook(hero, hook!, enemy)) {
			return
		}
		if (this.Enabled(ROT) && rot !== undefined && this.RotInRadius(rot, distance) && this.EnableRot(hero, rot)) {
			return
		}
		if (this.Enabled(FLESH_HEAP) && this.CastHeap(hero, heap, distance)) {
			return
		}
		if (this.Enabled(DISMEMBER) && this.Castable(dismember, enemy) && this.InCastRange(hero, dismember!, enemy)) {
			hero.CastTarget(dismember!, enemy)
			this.LockCast(dismember!)
			return
		}
		if (dragged) {
			return
		}
		this.Attack(hero, enemy)
	}

	private ComboHook(hero: Hero, hook: pudge_meat_hook, enemy: Hero): boolean {
		if (enemy.IsInvulnerable || enemy.IsUntargetable) {
			return false
		}
		const solution = this.predictor.Solve(hero, hook, enemy)
		if (solution.blocked || solution.outOfRange || solution.chance < COMBO_HOOK_CHANCE) {
			return false
		}
		this.CastHook(hero, hook, enemy, solution.point)
		return true
	}

	private CastHook(hero: Hero, hook: pudge_meat_hook, target: Hero, point: Vector3): void {
		hero.CastPosition(hook, point)
		this.LockCast(hook)
		this.hookOrderPoint = point
		this.hookOrderTarget = target
		this.hookOrderTime = GameState.RawGameTime
	}

	// The ordered point is only a promise: while the cast animation plays the target can
	// still break off, and a hook that is already going to miss is worth more cancelled.
	private WatchHookCancel(hero: Hero): void {
		const ordered = this.hookOrderPoint
		if (ordered === undefined) {
			return
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (hook === undefined) {
			this.hookOrderPoint = undefined
			return
		}
		if (!hook.IsInAbilityPhase) {
			if (GameState.RawGameTime - this.hookOrderTime > HOOK_WATCH_GRACE) {
				this.hookOrderPoint = undefined
			}
			return
		}
		const target = this.hookOrderTarget
		if (target === undefined || !this.IsValidTarget(target)) {
			return
		}
		const solution = this.predictor.Solve(hero, hook, target)
		const drift = solution.point.Distance2D(ordered)
		if (solution.chance >= CANCEL_CHANCE && drift <= this.predictor.Width(hook) * CANCEL_DEVIATION) {
			return
		}
		hero.OrderStop()
		this.hookOrderPoint = undefined
	}

	private InstantDismember(hero: Hero, dismember: Nullable<Ability>, victim: Hero): boolean {
		if (!this.Enabled(DISMEMBER) || !this.Castable(dismember, victim)) {
			return false
		}
		if (!this.InCastRange(hero, dismember!, victim, this.DragLead(hero, dismember!))) {
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

	// Dota measures a unit-target cast edge to edge, so a centre-to-centre compare is
	// stricter than the game and left Dismember refusing at ranges it would accept.
	private InCastRange(hero: Hero, ability: Ability, target: Hero, bonus = 0): boolean {
		const range = ability.CastRange > 0 ? ability.CastRange : DISMEMBER_RANGE_FALLBACK
		return hero.IsInRange(target, range + bonus)
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

	// Only ever switches Rot ON. Turning it off is the player's call — an automatic
	// switch-off fights every manual Rot the moment nobody is standing next to Pudge.
	private AutoRot(hero: Hero): void {
		const rot = hero.GetAbilityByClass(pudge_rot)
		if (rot === undefined || rot.Level === 0) {
			return
		}
		if (this.hookVictim === undefined && !this.Dismembering(hero)) {
			return
		}
		this.EnableRot(hero, rot)
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

	private RotInRadius(rot: Ability, distance: number): boolean {
		return distance <= (rot.GetBaseAOERadiusForLevel(rot.Level) || ROT_RADIUS_FALLBACK)
	}

	private EnableRot(hero: Hero, rot: Ability): boolean {
		if (rot.Level === 0 || hero.IsStunned || hero.HasBuffByName(ROT_MODIFIER)) {
			return false
		}
		const now = GameState.RawGameTime
		if (now - this.rotOrderTime < ROT_ORDER_GUARD) {
			return false
		}
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
		if (hero.IsAttacking && hero.IsInRange(enemy, hero.GetAttackRange(enemy))) {
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

	private FindEnemy(hero?: Hero, range = Number.MAX_VALUE): Nullable<Hero> {
		const cursor = InputManager.CursorOnWorld
		let target: Nullable<Hero>
		let closest = Number.MAX_VALUE
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!this.IsValidTarget(enemy)) {
				continue
			}
			if (hero !== undefined && hero.Distance2D(enemy) > range) {
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
		this.hookVictim = undefined
		this.hookVictimUntil = 0
		this.hookOrderPoint = undefined
		this.hookOrderTarget = undefined
		this.hookOrderTime = 0
		this.predictor.Reset()
		this.ClearTarget()
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.menu.AutoHookKey.isPressed = false
		this.Reset()
	}
}
