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
	Tree,
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

const HOOK_ABILITY = "pudge_meat_hook"
const ROT_ABILITY = "pudge_rot"
const DISMEMBER_ABILITY = "pudge_dismember"
const HOOK_MODIFIER = "modifier_pudge_meat_hook"
const ROT_MODIFIER = "modifier_pudge_rot"
const LINKEN_MODIFIER = "modifier_item_sphere_target"
const BKB_MODIFIER = "modifier_black_king_bar_immune"
const RUBICK_NAME = "npc_dota_hero_rubick"
const SPELL_STEAL = "rubick_spell_steal"

const HOOK_SPEED_FALLBACK = 1600
const HOOK_WIDTH_FALLBACK = 100
const RUBICK_GUARD_RANGE = 1400
const STRAIGHT_ANGLE = 0.35
const ORDER_GUARD = 0.03
const ATTACK_GAP = 0.1
const FAKE_HOOK_CANCEL = 0.05
const HITRUN_BACK = 250
const TREE_CUT_RANGE = 350
const COMBO_AFTER_HOOK_TIME = 3
const RANGE_KEY = "heroes_combo_pudge_range"
const LINE_KEY = "heroes_combo_pudge_line"
const READY_COLOR = new Color(120, 255, 60)
const BLOCK_COLOR = new Color(255, 60, 60)

export class PudgeCombo {
	private readonly particles = new ParticlesSDK()
	private pendingAbility: Nullable<Ability>
	private pendingTime = 0
	private lastAttackTime = 0
	private fakeHookTime = 0
	private fakeHookHeld = false
	private hookedUntil = 0

	constructor(private readonly menu: PudgeMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("Draw", this.Draw.bind(this))
		EventsSDK.on("ModifierCreated", this.ModifierCreated.bind(this))
		EventsSDK.on("PrepareUnitOrders", this.PrepareUnitOrders.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<Hero> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid || !hero.IsAlive) {
			return undefined
		}
		return hero.Name === "npc_dota_hero_pudge" ? hero : undefined
	}

	private get InGame(): boolean {
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return false
		}
		return GameRules?.GameState === DOTAGameState.DOTA_GAMERULES_STATE_GAME_IN_PROGRESS
	}

	private ModifierCreated(modifier: Modifier): void {
		if (modifier.Name !== HOOK_MODIFIER) {
			return
		}
		const parent = modifier.Parent
		if (parent === undefined || !parent.IsEnemy()) {
			return
		}
		this.hookedUntil = GameState.RawGameTime + COMBO_AFTER_HOOK_TIME
	}

	private PrepareUnitOrders(order: ExecuteOrder): boolean {
		if (!this.menu.State.value || !this.menu.ComboOnUltKey.value || !order.IsPlayerInput) {
			return true
		}
		const hero = this.Hero
		const ability = order.Ability_
		if (hero === undefined || !(ability instanceof Ability) || ability.Owner !== hero) {
			return true
		}
		if (ability.Name === DISMEMBER_ABILITY) {
			this.hookedUntil = GameState.RawGameTime + COMBO_AFTER_HOOK_TIME
		}
		return true
	}

	private PostDataUpdate(): void {
		const hero = this.Hero
		if (!this.menu.State.value || !this.InGame || hero === undefined) {
			this.Reset()
			return
		}
		const enemy = this.FindEnemy()
		this.UpdateVisuals(hero, enemy)
		if (hero.IsStunned || !this.CanAct()) {
			return
		}
		if (this.FakeHook(hero)) {
			return
		}
		if (this.AllyHook(hero)) {
			return
		}
		if (enemy === undefined) {
			return
		}
		if (this.menu.AutoHookKey.isPressed && this.AutoHook(hero, enemy)) {
			return
		}
		if (this.ComboActive()) {
			this.Execute(hero, enemy)
		}
	}

	private ComboActive(): boolean {
		if (this.menu.ComboKey.isPressed) {
			return true
		}
		return this.menu.ComboAfterHook.value && GameState.RawGameTime < this.hookedUntil
	}

	private Execute(hero: Hero, enemy: Hero): void {
		if (this.BreakLinken(hero, enemy)) {
			return
		}
		const hook = hero.GetAbilityByName(HOOK_ABILITY)
		const rot = hero.GetAbilityByClass(pudge_rot)
		const dismember = hero.GetAbilityByName(DISMEMBER_ABILITY)
		const distance = hero.Distance2D(enemy)
		const hooked = enemy.HasBuffByName(HOOK_MODIFIER)

		if (
			!hooked &&
			this.Enabled(HOOK_ABILITY) &&
			hook instanceof pudge_meat_hook &&
			this.Ready(hook) &&
			distance <= hook.CastRange &&
			this.HookAllowed(hero, enemy)
		) {
			this.CastHook(hero, hook, enemy)
			return
		}

		if (this.Enabled(ROT_ABILITY) && rot !== undefined && this.RotShouldBeOn(hero, rot, distance)) {
			hero.CastToggle(rot)
			this.LockCast(rot)
			return
		}

		if (
			this.Enabled(DISMEMBER_ABILITY) &&
			dismember !== undefined &&
			this.Ready(dismember) &&
			distance <= dismember.CastRange &&
			!enemy.HasBuffByName(BKB_MODIFIER)
		) {
			hero.CastTarget(dismember, enemy)
			this.LockCast(dismember)
			return
		}

		if (this.UseItems(hero, enemy, distance)) {
			return
		}
		this.Attack(hero, enemy)
	}

	private RotShouldBeOn(hero: Hero, rot: Ability, distance: number): boolean {
		const radius = rot.GetBaseAOERadiusForLevel(rot.Level)
		const inside = distance <= (radius > 0 ? radius : 250)
		return inside !== hero.HasBuffByName(ROT_MODIFIER) && inside
	}

	private AutoHook(hero: Hero, enemy: Hero): boolean {
		const hook = hero.GetAbilityByName(HOOK_ABILITY)
		if (!(hook instanceof pudge_meat_hook) || !this.Ready(hook)) {
			return false
		}
		if (hero.Distance2D(enemy) > hook.CastRange) {
			return false
		}
		if (!this.HookAllowed(hero, enemy) || !this.GuaranteedHit(enemy)) {
			return false
		}
		this.CastHook(hero, hook, enemy)
		return true
	}

	private CastHook(hero: Hero, hook: pudge_meat_hook, target: Hero): void {
		if (this.CutTree(hero, target)) {
			return
		}
		hero.CastPosition(hook, this.HookPoint(hero, hook, target))
		this.LockCast(hook)
	}

	private HookPoint(hero: Hero, hook: pudge_meat_hook, target: Hero): Vector3 {
		const speed = hook.GetBaseSpeedForLevel(hook.Level) || HOOK_SPEED_FALLBACK
		const base = hook.CastDelay + GameState.InputLag
		let point = target.GetPredictionPosition(base + hero.Distance2D(target) / speed, true)
		point = target.GetPredictionPosition(base + hero.Distance2D(point) / speed, true)
		return point
	}

	private GuaranteedHit(target: Hero): boolean {
		if (target.IsStunned || target.IsRooted || target.IsHexed || target.IsChanneling) {
			return true
		}
		if (!target.IsMoving) {
			return true
		}
		const facing = target.Forward
		const toHero = target.Position.GetDirectionTo(target.GetPredictionPosition(0.3, true))
		return Math.abs(facing.AngleBetweenFaces(toHero)) <= STRAIGHT_ANGLE
	}

	private HookAllowed(hero: Hero, target: Hero): boolean {
		if (this.menu.AntiRubick.value && this.RubickWatching(hero)) {
			return false
		}
		if (this.menu.SpecificSpots.value && this.TreeOnPath(hero, target) !== undefined) {
			return false
		}
		return true
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

	private TreeOnPath(hero: Hero, target: Hero): Nullable<Tree> {
		const hook = hero.GetAbilityByName(HOOK_ABILITY)
		const width =
			hook instanceof pudge_meat_hook
				? hook.GetBaseAOERadiusForLevel(hook.Level) || HOOK_WIDTH_FALLBACK
				: HOOK_WIDTH_FALLBACK
		const start = new Vector2(hero.Position.x, hero.Position.y)
		const end = new Vector2(target.Position.x, target.Position.y)
		return EntityManager.GetEntitiesByClass(Tree).find(tree => {
			if (!tree.IsValid || !tree.IsAlive) {
				return false
			}
			const position = new Vector2(tree.Position.x, tree.Position.y)
			return position.DistanceSegment(start, end, true) <= width
		})
	}

	private CutTree(hero: Hero, target: Hero): boolean {
		if (!this.menu.HookState.value) {
			return false
		}
		const tree = this.TreeOnPath(hero, target)
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
		const pressed = this.menu.HookState.value && this.menu.FakeHookKey.isPressed
		if (!pressed) {
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
		const hook = hero.GetAbilityByName(HOOK_ABILITY)
		if (!(hook instanceof pudge_meat_hook) || !this.Ready(hook)) {
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
		const hook = hero.GetAbilityByName(HOOK_ABILITY)
		if (!(hook instanceof pudge_meat_hook) || !this.Ready(hook)) {
			return false
		}
		const ally = this.FindAlly(hero, hook.CastRange)
		if (ally === undefined) {
			return false
		}
		hero.CastPosition(hook, this.HookPoint(hero, hook, ally))
		this.LockCast(hook)
		return true
	}

	private BreakLinken(hero: Hero, enemy: Hero): boolean {
		if (!enemy.HasBuffByName(LINKEN_MODIFIER)) {
			return false
		}
		for (const name of PUDGE_LINKEN_BREAKERS) {
			if (!this.menu.LinkenBreakers.IsEnabled(name)) {
				continue
			}
			const item = this.FindItem(hero, name)
			if (item === undefined || !item.CanBeCasted()) {
				continue
			}
			if (hero.Distance2D(enemy) > item.CastRange || !this.TargetsEnemies(item)) {
				continue
			}
			hero.CastTarget(item, enemy)
			this.LockCast(item)
			return true
		}
		return false
	}

	private UseItems(hero: Hero, enemy: Hero, distance: number): boolean {
		for (const name of PUDGE_COMBO) {
			if (!name.startsWith("item_") || !this.Enabled(name)) {
				continue
			}
			const item = this.FindItem(hero, name)
			if (item === undefined || !item.CanBeCasted()) {
				continue
			}
			const range = item.CastRange > 0 ? item.CastRange : hero.GetAttackRange(enemy)
			if (distance > range) {
				continue
			}
			this.CastAuto(hero, item, enemy)
			return true
		}
		return false
	}

	private Attack(hero: Hero, enemy: Hero): void {
		const mode = this.menu.AutoAttack.SelectedID as AutoAttackMode
		if (mode === AutoAttackMode.Disabled) {
			return
		}
		const now = GameState.RawGameTime
		if (now - this.lastAttackTime < ATTACK_GAP) {
			return
		}
		if (this.menu.HitRunAfterCombo.value && hero.IsAttacking && !enemy.IsStunned) {
			this.lastAttackTime = now
			hero.MoveTo(enemy.Position.Extend(hero.Position, HITRUN_BACK))
			return
		}
		if (hero.IsAttacking && hero.Distance2D(enemy) <= hero.GetAttackRange(enemy)) {
			return
		}
		this.lastAttackTime = now
		hero.AttackTarget(enemy)
	}

	private CastAuto(hero: Hero, ability: Ability, enemy: Hero): void {
		if (ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET)) {
			hero.CastTarget(ability, this.TargetsEnemies(ability) ? enemy : hero)
		} else if (ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)) {
			hero.CastPosition(ability, enemy.Position)
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

	private FindAlly(hero: Hero, range: number): Nullable<Hero> {
		const cursor = InputManager.CursorOnWorld
		let target: Nullable<Hero>
		let closest = Number.MAX_VALUE
		for (const ally of EntityManager.GetEntitiesByClass(Hero)) {
			if (ally === hero || ally.IsEnemy() || !ally.IsValid || !ally.IsAlive) {
				continue
			}
			if (ally.IsIllusion || hero.Distance2D(ally) > range) {
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

	private UpdateVisuals(hero: Hero, enemy: Nullable<Hero>): void {
		if (!this.menu.HookState.value || !this.ShouldDraw()) {
			this.ClearVisuals()
			return
		}
		const hook = hero.GetAbilityByName(HOOK_ABILITY)
		if (!(hook instanceof pudge_meat_hook) || hook.Level === 0) {
			this.ClearVisuals()
			return
		}
		const blocked = enemy !== undefined && !this.HookAllowed(hero, enemy)
		const color = blocked ? BLOCK_COLOR : READY_COLOR
		this.particles.DrawCircle(RANGE_KEY, hero, hook.CastRange, { Color: color })
		if (enemy === undefined || hero.Distance2D(enemy) > hook.CastRange) {
			this.particles.DestroyByKey(LINE_KEY)
			return
		}
		this.particles.DrawLine(LINE_KEY, hero, this.HookPoint(hero, hook, enemy), {
			Color: color,
			Width: 20
		})
	}

	private ClearVisuals(): void {
		this.particles.DestroyByKey(RANGE_KEY)
		this.particles.DestroyByKey(LINE_KEY)
	}

	private Draw(): void {
		if (!this.menu.State.value || !this.InGame) {
			this.ClearVisuals()
		}
	}

	private Reset(): void {
		this.pendingAbility = undefined
		this.pendingTime = 0
		this.lastAttackTime = 0
		this.fakeHookHeld = false
		this.fakeHookTime = 0
		this.hookedUntil = 0
		this.ClearVisuals()
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.menu.AutoHookKey.isPressed = false
		this.menu.FakeHookKey.isPressed = false
		this.menu.AllyHookKey.isPressed = false
		this.Reset()
	}
}
