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
	Item,
	LifeState,
	LocalPlayer,
	Modifier,
	ParticlesSDK,
	pudge_meat_hook,
	pudge_rot,
	Tower,
	Tree,
	Unit,
	Vector2,
	Vector3,
	VKeys
} from "github.com/octarine-public/wrapper/index"

import {
	AutoAttackMode,
	HookDrawMode,
	PUDGE_COMBO,
	PUDGE_LINKEN_BREAKERS,
	PUDGE_TREE_CUTTERS,
	PudgeMenu
} from "./pudge-menu"

const PUDGE_NAME = "npc_dota_hero_pudge"
const HOOK = "pudge_meat_hook"
const ROT = "pudge_rot"
const DISMEMBER = "pudge_dismember"
const EJECT = "pudge_eject"
const HOOK_MODIFIER = "modifier_pudge_meat_hook"
const ROT_MODIFIER = "modifier_pudge_rot"
const LINKEN_MODIFIER = "modifier_item_sphere_target"
const ETHEREAL_MODIFIER = "modifier_item_ethereal_blade_slow"
const RUBICK_NAME = "npc_dota_hero_rubick"
const SPELL_STEAL = "rubick_spell_steal"

const HOOK_SPEED_FALLBACK = 1600
const HOOK_WIDTH_FALLBACK = 100
const HOOK_RANGE_FALLBACK = 1000
const ROT_RADIUS_FALLBACK = 250
const DISMEMBER_RANGE_FALLBACK = 175
const SHIVA_RADIUS_FALLBACK = 900
const ITEM_SELF_RANGE = 600
const ENGAGE_RANGE = 600
const BLINK_MIN_GAP = 700
const BLINK_LANDING_GAP = 350
const RUBICK_GUARD_RANGE = 1600
const TREE_CUT_RANGE = 350
const TOWER_SEARCH_RADIUS = 1600
const EJECT_HOLD_RANGE = 400

const PREDICTION_PASSES = 3
const STRAIGHT_ANGLE = 0.35
const TURN_TOLERANCE = 0.2
const TURN_MEMORY = 0.35
const ROT_HYSTERESIS = 1.15
const ROT_MIN_HP = 12
const ROT_ORDER_GUARD = 0.3
const ORDER_GUARD = 0.03
const ATTACK_GAP = 0.06
const FAKE_HOOK_CANCEL = 0.05
const HITRUN_BACK = 300
const COMBO_HOLD_TIME = 3.5

const RANGE_KEY = "heroes_combo_pudge_range"
const LINE_KEY = "heroes_combo_pudge_line"
const READY_COLOR = new Color(120, 255, 60)
const BLOCK_COLOR = new Color(255, 60, 60)

interface IHeading {
	angle: number
	turned: number
}

export class PudgeCombo {
	private readonly particles = new ParticlesSDK()
	private readonly headings = new Map<number, IHeading>()
	private pendingAbility: Nullable<Ability>
	private pendingTime = 0
	private lastOrderTime = 0
	private fakeHookTime = 0
	private fakeHookHeld = false
	private comboUntil = 0
	private rotOrderTime = 0
	private rotOrderWant = false

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
		if (!this.menu.ComboAfterHook.value) {
			return
		}
		const hero = this.Hero
		const parent = modifier.Parent
		if (hero === undefined || parent === undefined || !parent.IsEnemy()) {
			return
		}
		if (modifier.Caster !== undefined && modifier.Caster !== hero) {
			return
		}
		this.comboUntil = GameState.RawGameTime + COMBO_HOLD_TIME
	}

	private PrepareUnitOrders(order: ExecuteOrder): boolean {
		if (!this.menu.State.value || !this.menu.ComboOnUlt.value || !order.IsPlayerInput) {
			return true
		}
		const hero = this.Hero
		const ability = order.Ability_
		if (hero === undefined || !(ability instanceof Ability) || ability.Owner !== hero) {
			return true
		}
		if (ability.Name === DISMEMBER) {
			this.comboUntil = GameState.RawGameTime + COMBO_HOLD_TIME
		}
		return true
	}

	private PostDataUpdate(): void {
		const hero = this.Hero
		if (!this.menu.State.value || !this.InGame || hero === undefined) {
			this.Reset()
			return
		}
		this.UpdateHeadings()
		const target = this.FindEnemy()
		this.UpdateVisuals(hero, target)
		if (hero.IsChanneling) {
			return
		}
		if (this.FakeHook(hero)) {
			return
		}
		if (hero.IsStunned || !this.CanAct()) {
			return
		}
		if (this.EjectToTower(hero)) {
			return
		}
		if (this.AllyHook(hero)) {
			return
		}
		if (target !== undefined && this.menu.AutoHookKey.isPressed && this.AutoHook(hero, target)) {
			return
		}
		if (this.ComboActive()) {
			if (target !== undefined) {
				this.Execute(hero, target)
			}
			return
		}
		this.Automation(hero)
	}

	private ComboActive(): boolean {
		return this.menu.ComboKey.isPressed || GameState.RawGameTime < this.comboUntil
	}

	private Execute(hero: Hero, target: Hero): void {
		const distance = hero.Distance2D(target)
		const rot = hero.GetAbilityByClass(pudge_rot)
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		const dismember = hero.GetAbilityByName(DISMEMBER)

		if (this.Enabled(ROT) && rot !== undefined && this.ToggleRot(hero, rot, distance)) {
			return
		}
		if (
			this.Enabled(HOOK) &&
			hook !== undefined &&
			this.Ready(hook) &&
			!target.HasBuffByName(HOOK_MODIFIER) &&
			this.ThrowHook(hero, hook, target)
		) {
			return
		}
		if (this.BreakLinken(hero, target, distance)) {
			return
		}
		if (this.UseItems(hero, target, distance)) {
			return
		}
		if (this.Enabled(DISMEMBER) && this.CanDismember(dismember, target, distance)) {
			hero.CastTarget(dismember!, target)
			this.LockCast(dismember!)
			return
		}
		this.Attack(hero, target)
	}

	private Automation(hero: Hero): void {
		if (this.menu.AutoDismember.value && this.AutoDismember(hero)) {
			return
		}
		if (this.menu.AutoRot.value) {
			this.AutoRot(hero)
		}
	}

	private AutoDismember(hero: Hero): boolean {
		const dismember = hero.GetAbilityByName(DISMEMBER)
		const target = this.FindHooked(hero)
		if (target === undefined || !this.CanDismember(dismember, target, hero.Distance2D(target))) {
			return false
		}
		hero.CastTarget(dismember!, target)
		this.LockCast(dismember!)
		return true
	}

	private AutoRot(hero: Hero): void {
		const rot = hero.GetAbilityByClass(pudge_rot)
		if (rot === undefined || rot.Level === 0) {
			return
		}
		const target = this.NearestEnemy(hero)
		const distance = target === undefined ? Number.MAX_VALUE : hero.Distance2D(target)
		this.ToggleRot(hero, rot, distance)
	}

	private ToggleRot(hero: Hero, rot: Ability, distance: number): boolean {
		if (rot.Level === 0) {
			return false
		}
		const radius = rot.GetBaseAOERadiusForLevel(rot.Level) || ROT_RADIUS_FALLBACK
		const on = hero.HasBuffByName(ROT_MODIFIER)
		const want = distance <= (on ? radius * ROT_HYSTERESIS : radius) && hero.HPPercent > ROT_MIN_HP
		if (want === on || (want && !rot.CanBeCasted())) {
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

	private AutoHook(hero: Hero, target: Hero): boolean {
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (hook === undefined || !this.Ready(hook) || !this.Enabled(HOOK)) {
			return false
		}
		if (!this.GuaranteedHit(target)) {
			return false
		}
		return this.ThrowHook(hero, hook, target)
	}

	private ThrowHook(hero: Hero, hook: pudge_meat_hook, target: Hero): boolean {
		const range = this.HookRange(hook)
		if (hero.Distance2D(target) > range || !this.HookAllowed(hero, target)) {
			return false
		}
		const point = this.HookPoint(hero, hook, target)
		if (hero.Distance2D(point) > range) {
			return false
		}
		if (this.CutTree(hero, point)) {
			return true
		}
		if (this.PathBlocked(hero, hook, target, point)) {
			return false
		}
		hero.CastPosition(hook, point)
		this.LockCast(hook)
		return true
	}

	private HookRange(hook: pudge_meat_hook): number {
		return hook.CastRange > 0 ? hook.CastRange : HOOK_RANGE_FALLBACK
	}

	private HookWidth(hook: pudge_meat_hook): number {
		return hook.GetBaseAOERadiusForLevel(hook.Level) || HOOK_WIDTH_FALLBACK
	}

	private HookPoint(hero: Hero, hook: pudge_meat_hook, target: Unit): Vector3 {
		const speed = hook.GetBaseSpeedForLevel(hook.Level) || HOOK_SPEED_FALLBACK
		let point = target.Position
		for (let i = 0; i < PREDICTION_PASSES; i++) {
			point = target.GetPredictionPosition(hook.CastDelay + hero.Distance2D(point) / speed, true)
		}
		return point
	}

	private GuaranteedHit(target: Hero): boolean {
		if (target.IsStunned || target.IsRooted || target.IsHexed || target.IsChanneling) {
			return true
		}
		if (!target.IsMoving) {
			return true
		}
		const heading = this.headings.get(target.Index)
		if (heading !== undefined && GameState.RawGameTime - heading.turned < TURN_MEMORY) {
			return false
		}
		const forward = target.Forward
		const course = target.Position.GetDirectionTo(target.GetPredictionPosition(0.3, true))
		return Math.abs(forward.AngleBetweenFaces(course)) <= STRAIGHT_ANGLE
	}

	private UpdateHeadings(): void {
		const now = GameState.RawGameTime
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!this.IsValidTarget(enemy)) {
				continue
			}
			const angle = Math.atan2(enemy.Forward.y, enemy.Forward.x)
			const heading = this.headings.get(enemy.Index)
			if (heading === undefined) {
				this.headings.set(enemy.Index, { angle, turned: now })
				continue
			}
			let delta = Math.abs(angle - heading.angle)
			if (delta > Math.PI) {
				delta = Math.PI * 2 - delta
			}
			if (delta > TURN_TOLERANCE) {
				heading.turned = now
			}
			heading.angle = angle
		}
	}

	private HookAllowed(hero: Hero, target: Unit): boolean {
		if (target.IsInvulnerable || target.IsUntargetable) {
			return false
		}
		return !this.menu.AntiRubick.value || !this.RubickWatching(hero)
	}

	private RubickWatching(hero: Hero): boolean {
		return EntityManager.GetEntitiesByClass(Hero).some(enemy => {
			if (!this.IsValidTarget(enemy) || enemy.Name !== RUBICK_NAME) {
				return false
			}
			if (hero.Distance2D(enemy) > RUBICK_GUARD_RANGE) {
				return false
			}
			const steal = enemy.GetAbilityByName(SPELL_STEAL)
			return steal === undefined || steal.Cooldown <= 0
		})
	}

	private PathBlocked(hero: Hero, hook: pudge_meat_hook, target: Unit, point: Vector3): boolean {
		const width = this.HookWidth(hook)
		const start = new Vector2(hero.Position.x, hero.Position.y)
		const end = new Vector2(point.x, point.y)
		const reach = hero.Distance2D(target)
		const blocker = EntityManager.GetEntitiesByClass(Unit).some(unit => {
			if (unit === hero || unit === target || !unit.IsValid || !unit.IsAlive) {
				return false
			}
			if (unit.IsBuilding || unit.IsInvulnerable || unit.IsUntargetable) {
				return false
			}
			if (unit.IsCourier || unit.IsFlyingVisually || !unit.IsVisible) {
				return false
			}
			if (hero.Distance2D(unit) >= reach) {
				return false
			}
			const position = new Vector2(unit.Position.x, unit.Position.y)
			return position.DistanceSegment(start, end, true) <= width + unit.HullRadius
		})
		if (blocker) {
			return true
		}
		return this.menu.SpecificSpots.value && this.TreeOnPath(hero, width, point) !== undefined
	}

	private TreeOnPath(hero: Hero, width: number, point: Vector3): Nullable<Tree> {
		const start = new Vector2(hero.Position.x, hero.Position.y)
		const end = new Vector2(point.x, point.y)
		return EntityManager.GetEntitiesByClass(Tree).find(tree => {
			if (!tree.IsValid || !tree.IsAlive) {
				return false
			}
			const position = new Vector2(tree.Position.x, tree.Position.y)
			return position.DistanceSegment(start, end, true) <= width
		})
	}

	private CutTree(hero: Hero, point: Vector3): boolean {
		if (!this.menu.HookState.value) {
			return false
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (hook === undefined) {
			return false
		}
		const tree = this.TreeOnPath(hero, this.HookWidth(hook), point)
		if (tree === undefined || hero.Distance2D(tree) > TREE_CUT_RANGE) {
			return false
		}
		for (const name of PUDGE_TREE_CUTTERS) {
			if (!this.menu.TreeCutters.IsEnabled(name)) {
				continue
			}
			const item = hero.GetItemByName(name)
			if (item === undefined || !item.CanBeCasted()) {
				continue
			}
			hero.CastTargetTree(item, tree)
			this.LockCast(item)
			return true
		}
		return false
	}

	private FakeHook(hero: Hero): boolean {
		if (!this.menu.HookState.value || !this.menu.FakeHookKey.isPressed) {
			this.fakeHookHeld = false
			return false
		}
		const now = GameState.RawGameTime
		if (this.fakeHookHeld) {
			if (this.fakeHookTime !== 0 && now - this.fakeHookTime >= FAKE_HOOK_CANCEL) {
				hero.OrderStop()
				this.fakeHookTime = 0
			}
			return true
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (hook === undefined || !this.Ready(hook)) {
			return false
		}
		this.fakeHookHeld = true
		this.fakeHookTime = now
		hero.CastPosition(hook, InputManager.CursorOnWorld)
		return true
	}

	private AllyHook(hero: Hero): boolean {
		if (!this.menu.HookState.value || !this.menu.AllyHookKey.isPressed) {
			return false
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (hook === undefined || !this.Ready(hook)) {
			return false
		}
		const ally = this.FindAlly(hero, this.HookRange(hook))
		if (ally === undefined) {
			return false
		}
		const point = this.HookPoint(hero, hook, ally)
		if (this.PathBlocked(hero, hook, ally, point)) {
			return false
		}
		hero.CastPosition(hook, point)
		this.LockCast(hook)
		return true
	}

	private EjectToTower(hero: Hero): boolean {
		if (!this.menu.EjectKey.isPressed) {
			return false
		}
		const eject = hero.GetAbilityByName(EJECT)
		if (eject === undefined || !this.Ready(eject)) {
			return false
		}
		const held = this.FindHooked(hero) ?? this.NearestEnemy(hero, EJECT_HOLD_RANGE)
		if (held === undefined) {
			return false
		}
		const tower = this.FindTower(held)
		if (tower === undefined) {
			return false
		}
		if (eject.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)) {
			hero.CastPosition(eject, tower.Position)
		} else {
			hero.CastNoTarget(eject)
		}
		this.LockCast(eject)
		return true
	}

	private BreakLinken(hero: Hero, target: Hero, distance: number): boolean {
		if (!target.HasBuffByName(LINKEN_MODIFIER) || distance > ENGAGE_RANGE) {
			return false
		}
		for (const name of PUDGE_LINKEN_BREAKERS) {
			if (!this.menu.LinkenBreakers.IsEnabled(name)) {
				continue
			}
			const item = this.FindItem(hero, name)
			if (item === undefined || !item.CanBeCasted() || !this.TargetsEnemies(item)) {
				continue
			}
			if (distance > item.CastRange) {
				continue
			}
			hero.CastTarget(item, target)
			this.LockCast(item)
			return true
		}
		return false
	}

	private UseItems(hero: Hero, target: Hero, distance: number): boolean {
		for (const name of PUDGE_COMBO) {
			if (!name.startsWith("item_") || !this.Enabled(name)) {
				continue
			}
			const item = this.FindItem(hero, name)
			if (item === undefined || !item.CanBeCasted()) {
				continue
			}
			if (!this.ItemAllowed(hero, item, target, distance)) {
				continue
			}
			if (this.IsBlink(item)) {
				hero.CastPosition(item, this.BlinkPoint(hero, item, target))
				this.LockCast(item)
				return true
			}
			this.CastAuto(hero, item, target)
			return true
		}
		return false
	}

	private ItemAllowed(hero: Hero, item: Item, target: Hero, distance: number): boolean {
		if (this.IsBlink(item)) {
			return this.BlinkNeeded(hero, target, distance)
		}
		if (this.TargetsEnemies(item) && (target.IsMagicImmune || target.HasBuffByName(LINKEN_MODIFIER))) {
			return false
		}
		if (item.Name === "item_shivas_guard") {
			return distance <= (item.GetSpecialValue("blast_radius") || SHIVA_RADIUS_FALLBACK)
		}
		if (item.Name === "item_black_king_bar" || item.Name === "item_blade_mail") {
			return distance <= ENGAGE_RANGE
		}
		if (item.Name.startsWith("item_dagon") && this.EtherealPending(hero, target)) {
			return false
		}
		const range = item.CastRange > 0 ? item.CastRange : ITEM_SELF_RANGE
		return distance <= range
	}

	private EtherealPending(hero: Hero, target: Hero): boolean {
		if (!this.Enabled("item_ethereal_blade") || target.HasBuffByName(ETHEREAL_MODIFIER)) {
			return false
		}
		const ethereal = this.FindItem(hero, "item_ethereal_blade")
		return ethereal !== undefined && ethereal.CanBeCasted()
	}

	private BlinkNeeded(hero: Hero, target: Hero, distance: number): boolean {
		if (distance <= BLINK_MIN_GAP) {
			return false
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (hook === undefined || !this.Enabled(HOOK) || !this.Ready(hook)) {
			return true
		}
		return distance > this.HookRange(hook)
	}

	private BlinkPoint(hero: Hero, blink: Item, target: Hero): Vector3 {
		const point = target.Position.Extend(hero.Position, BLINK_LANDING_GAP)
		const range = blink.CastRange
		if (range <= 0 || hero.Distance2D(point) <= range) {
			return point
		}
		return hero.Position.Extend(point, range)
	}

	private IsBlink(item: Item): boolean {
		return item.Name.endsWith("blink")
	}

	private CanDismember(ability: Nullable<Ability>, target: Hero, distance: number): boolean {
		if (!this.Ready(ability)) {
			return false
		}
		const range = ability!.CastRange > 0 ? ability!.CastRange : DISMEMBER_RANGE_FALLBACK
		if (distance > range) {
			return false
		}
		if (target.IsMagicImmune || target.IsInvulnerable || target.IsUntargetable) {
			return false
		}
		return !target.HasBuffByName(LINKEN_MODIFIER)
	}

	private Attack(hero: Hero, target: Hero): void {
		if ((this.menu.AutoAttack.SelectedID as AutoAttackMode) === AutoAttackMode.Disabled) {
			return
		}
		const now = GameState.RawGameTime
		if (now - this.lastOrderTime < ATTACK_GAP) {
			return
		}
		const range = hero.GetAttackRange(target)
		const distance = hero.Distance2D(target)
		if (distance > range) {
			this.lastOrderTime = now
			hero.AttackTarget(target)
			return
		}
		if (hero.IsAttackReady) {
			if (!hero.IsAttacking) {
				this.lastOrderTime = now
				hero.AttackTarget(target)
			}
			return
		}
		if (this.menu.HitRun.value && !hero.IsAttacking) {
			this.lastOrderTime = now
			hero.MoveTo(target.Position.Extend(hero.Position, HITRUN_BACK))
		}
	}

	private CastAuto(hero: Hero, ability: Ability, target: Hero): void {
		if (ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET)) {
			hero.CastTarget(ability, this.TargetsEnemies(ability) ? target : hero)
		} else if (ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)) {
			hero.CastPosition(ability, target.Position)
		} else if (ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_TOGGLE)) {
			hero.CastToggle(ability)
		} else {
			hero.CastNoTarget(ability)
		}
		this.LockCast(ability)
	}

	private TargetsEnemies(ability: Ability): boolean {
		return (
			ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET) &&
			ability.TargetTeamMask.hasMask(DOTA_UNIT_TARGET_TEAM.DOTA_UNIT_TARGET_TEAM_ENEMY)
		)
	}

	private FindItem(hero: Hero, name: string): Nullable<Item> {
		return hero.Items.find(item => {
			if (item.Name === name) {
				return true
			}
			if (name === "item_blink") {
				return item.Name.endsWith("blink")
			}
			if (name === "item_dagon_5") {
				return item.Name.startsWith("item_dagon")
			}
			return false
		})
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

	private NearestEnemy(hero: Hero, radius = Number.MAX_VALUE): Nullable<Hero> {
		let target: Nullable<Hero>
		let closest = radius
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

	private FindHooked(hero: Hero): Nullable<Hero> {
		return EntityManager.GetEntitiesByClass(Hero).find(
			enemy =>
				this.IsValidTarget(enemy) &&
				enemy.HasBuffByName(HOOK_MODIFIER) &&
				hero.Distance2D(enemy) <= EJECT_HOLD_RANGE
		)
	}

	private FindAlly(hero: Hero, range: number): Nullable<Hero> {
		const cursor = InputManager.CursorOnWorld
		let target: Nullable<Hero>
		let closest = Number.MAX_VALUE
		for (const ally of EntityManager.GetEntitiesByClass(Hero)) {
			if (ally === hero || ally.IsEnemy() || !ally.IsValid || ally.IsIllusion) {
				continue
			}
			if (ally.LifeState !== LifeState.LIFE_ALIVE || hero.Distance2D(ally) > range) {
				continue
			}
			const distance = ally.Distance2D(cursor)
			if (distance >= closest) {
				continue
			}
			closest = distance
			target = ally
		}
		return target
	}

	private FindTower(unit: Unit): Nullable<Tower> {
		let target: Nullable<Tower>
		let closest = TOWER_SEARCH_RADIUS
		for (const tower of EntityManager.GetEntitiesByClass(Tower)) {
			if (!tower.IsValid || !tower.IsAlive || tower.IsEnemy()) {
				continue
			}
			const distance = tower.Distance2D(unit)
			if (distance >= closest) {
				continue
			}
			closest = distance
			target = tower
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
		return this.menu.Combo.IsEnabled(name)
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

	private ShouldDraw(): boolean {
		const mode = this.menu.DrawMode.SelectedID as HookDrawMode
		if (mode === HookDrawMode.Never) {
			return false
		}
		if (mode === HookDrawMode.Always) {
			return true
		}
		return InputManager.IsKeyDown(VKeys.MENU)
	}

	private UpdateVisuals(hero: Hero, target: Nullable<Hero>): void {
		if (!this.menu.HookState.value || !this.ShouldDraw()) {
			this.ClearVisuals()
			return
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (hook === undefined || hook.Level === 0) {
			this.ClearVisuals()
			return
		}
		const range = this.HookRange(hook)
		this.particles.DrawCircle(RANGE_KEY, hero, range, { Color: READY_COLOR })
		if (target === undefined || hero.Distance2D(target) > range) {
			this.particles.DestroyByKey(LINE_KEY)
			return
		}
		const point = this.HookPoint(hero, hook, target)
		const blocked = !this.HookAllowed(hero, target) || this.PathBlocked(hero, hook, target, point)
		this.particles.DrawLine(LINE_KEY, hero, point, {
			Color: blocked ? BLOCK_COLOR : READY_COLOR,
			Width: 20
		})
	}

	private ClearVisuals(): void {
		this.particles.DestroyByKey(RANGE_KEY)
		this.particles.DestroyByKey(LINE_KEY)
	}

	private Reset(): void {
		this.pendingAbility = undefined
		this.pendingTime = 0
		this.lastOrderTime = 0
		this.fakeHookHeld = false
		this.fakeHookTime = 0
		this.comboUntil = 0
		this.rotOrderTime = 0
		this.rotOrderWant = false
		this.headings.clear()
		this.ClearVisuals()
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.menu.AutoHookKey.isPressed = false
		this.menu.FakeHookKey.isPressed = false
		this.menu.AllyHookKey.isPressed = false
		this.menu.EjectKey.isPressed = false
		this.Reset()
	}
}
