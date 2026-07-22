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
	UnitPortalData,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { HookPredictor, IHookPredictOptions, IHookSolution } from "./hook-predict"
import { PUDGE_ITEMS, PudgeMenu } from "./pudge-menu"

const PUDGE_NAME = "npc_dota_hero_pudge"
const HOOK = "pudge_meat_hook"
const ROT = "pudge_rot"
const FLESH_HEAP = "pudge_flesh_heap"
const DISMEMBER = "pudge_dismember"

const HOOK_MODIFIER = "modifier_pudge_meat_hook"
const ROT_MODIFIER = "modifier_pudge_rot"
const DISMEMBER_MODIFIER = "modifier_pudge_dismember"
const LINKEN_MODIFIER = "modifier_item_sphere_target"

const HOOK_RANGE_FALLBACK = 1000
const ROT_RADIUS_FALLBACK = 250
const DISMEMBER_RANGE_FALLBACK = 175
const HEAP_RANGE = 500

const AUTO_HOOK_CHANCE = 0.5
const COMBO_HOOK_CHANCE = 0.3
const HOOK_WATCH_GRACE = 0.5

const COMBO_HOLD_TIME = 3
const HOOK_DRAG_MAX = 2
const FAKE_HOOK_TIMEOUT = 0.5
const FAKE_HOOK_CANCEL_SAFETY = 0.005
const ROT_ORDER_GUARD = 0.3
const ORDER_GUARD = 0
const ATTACK_GAP = 0.1
const TELEPORT_ARRIVAL_HIT_DELAY = 0.03

const TIMED_EXIT_MODIFIERS = [
	"modifier_puck_phase_shift",
	"modifier_obsidian_destroyer_astral_imprisonment_prison",
	"modifier_shadow_demon_disruption",
	"modifier_eul_cyclone",
	"modifier_wind_waker",
	"modifier_cyclone",
	"modifier_brewmaster_storm_cyclone",
	"modifier_invoker_tornado",
	"modifier_disruptor_glimpse",
	"modifier_monkey_king_bounce_leap",
	"modifier_void_spirit_dissimilate_phase",
	"modifier_ember_spirit_sleight_of_fist_caster_invulnerability"
]

const ITEM_SELF_RANGE = 700
const ITEM_ENGAGE_RANGE = 650
const ITEM_CHASE_RANGE = 425
const BLINK_MIN_RANGE = 200
const BLINK_MAX_RANGE = 1200
const SOUL_RING_MAX_MANA = 45
const SOUL_RING_MIN_HP = 35
const BLOODSTONE_MAX_HP = 65
const SATANIC_MAX_HP = 35
const SHIVA_RADIUS_FALLBACK = 900
const ETHEREAL_MODIFIER = "modifier_item_ethereal_blade_slow"
const URN_MODIFIER = "modifier_item_urn_damage"
const VESSEL_MODIFIER = "modifier_item_spirit_vessel_damage"

const ITEM_PRIORITY = [
	"item_sheepstick",
	"item_black_king_bar",
	"item_ethereal_blade",
	"item_bloodthorn",
	"item_orchid",
	"item_nullifier",
	"item_veil_of_discord",
	"item_heavens_halberd",
	"item_spirit_vessel",
	"item_urn_of_shadows",
	"item_shivas_guard",
	"item_dagon_5",
	"item_rod_of_atos",
	"item_gungir",
	"item_abyssal_blade",
	"item_diffusal_blade",
	"item_disperser",
	"item_blood_grenade",
	"item_soul_ring",
	"item_satanic",
	"item_bloodstone",
	"item_blade_mail",
	"item_pipe",
	"item_lotus_orb",
	"item_armlet",
	"item_boots_of_bearing",
	"item_ancient_janggo",
	"item_mjollnir",
	"item_manta",
	"item_invis_sword",
	"item_silver_edge",
	"item_mask_of_madness",
	"item_refresher",
	"item_vanguard"
]

const LINKEN_BREAKERS = [
	"item_urn_of_shadows",
	"item_spirit_vessel",
	"item_diffusal_blade",
	"item_rod_of_atos",
	"item_harpoon",
	"item_orchid",
	"item_nullifier",
	"item_bloodthorn",
	"item_sheepstick"
]

const TARGET_LINE_KEY = "heroes_combo_pudge_target"
const TARGET_LINE_COLOR = new Color(255, 40, 40)

interface IPortalTrack {
	model: UnitPortalData
	startTime: number
	finishTime: number
}

export class PudgeCombo {
	private readonly particles = new ParticlesSDK()
	private readonly predictor = new HookPredictor()
	private readonly portals = new Map<UnitPortalData, IPortalTrack>()
	private readonly relocatePortals = new Map<Modifier, UnitPortalData>()
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
	private hookTeleportTimed = false
	private hookPortal: Nullable<IPortalTrack>
	private hookExitModifier: Nullable<Modifier>
	private fakeHookPending = false
	private fakeHookTime = 0

	constructor(private readonly menu: PudgeMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("ModifierCreated", this.ModifierCreated.bind(this))
		EventsSDK.on("ModifierRemoved", this.ModifierRemoved.bind(this))
		EventsSDK.on("PrepareUnitOrders", this.PrepareUnitOrders.bind(this))
		EventsSDK.on("UnitPortalChanged", this.UnitPortalChanged.bind(this))
		EventsSDK.on("UnitPortalDestroyed", this.UnitPortalDestroyed.bind(this))
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

	private UnitPortalChanged(model: UnitPortalData): void {
		const caster = model.Caster
		if (caster !== undefined && !caster.IsEnemy()) {
			return
		}
		const current = this.portals.get(model)
		const startTime = current?.startTime ?? GameState.RawGameTime
		this.portals.set(model, {
			finishTime: startTime + model.MaxDuration,
			model,
			startTime
		})
	}

	private UnitPortalDestroyed(model: UnitPortalData): void {
		this.portals.delete(model)
	}

	private ModifierCreated(modifier: Modifier): void {
		this.TrackRelocate(modifier)
		if (modifier.Name !== HOOK_MODIFIER || !this.menu.State.value) {
			return
		}
		const hero = this.Hero
		const victim = modifier.Parent
		if (hero === undefined || !(victim instanceof Hero)) {
			return
		}
		if (modifier.Caster !== undefined && modifier.Caster !== hero) {
			return
		}
		if (!victim.IsEnemy()) {
			return
		}
		const now = GameState.RawGameTime
		this.hookVictim = victim
		this.hookVictimUntil = now + HOOK_DRAG_MAX
		this.hookOrderPoint = undefined
		this.hookTeleportTimed = false
		this.hookPortal = undefined
		this.hookExitModifier = undefined
		if (this.menu.ComboAfterHook.value) {
			this.comboUntil = now + COMBO_HOLD_TIME
			this.hookVictimUntil = this.comboUntil
		}
	}

	private TrackRelocate(modifier: Modifier): void {
		if (modifier.Name !== "modifier_wisp_relocate_thinker") {
			return
		}
		const caster = modifier.Caster
		const thinker = modifier.Parent
		if (caster === undefined || thinker === undefined || !thinker.Position.IsValid || !caster.IsEnemy()) {
			return
		}
		const abilityDelay =
			modifier.Ability?.GetSpecialValue("cast_delay") || modifier.Ability?.GetSpecialValue("delay") || 0
		const duration = abilityDelay || modifier.RemainingTime || modifier.Duration || 3
		const model = new UnitPortalData(caster.Index)
		model.AbilityName = "wisp_relocate"
		model.MaxDuration = duration
		model.UpdateData(undefined, caster.Position, thinker.Position)
		this.relocatePortals.set(modifier, model)
		this.UnitPortalChanged(model)
	}

	private ModifierRemoved(modifier: Modifier): void {
		const model = this.relocatePortals.get(modifier)
		if (model === undefined) {
			return
		}
		model.IsValid = false
		model.IsCanceled = modifier.RemainingTime > GameState.TickInterval
		this.relocatePortals.delete(modifier)
		this.UnitPortalDestroyed(model)
	}

	private PrepareUnitOrders(order: ExecuteOrder): boolean {
		const hero = this.Hero
		if (!order.IsPlayerInput) {
			return true
		}
		if (hero !== undefined && order.Issuers.includes(hero)) {
			this.comboUntil = 0
			this.hookOrderPoint = undefined
			this.hookOrderTarget = undefined
			this.hookTeleportTimed = false
			this.hookPortal = undefined
			this.hookExitModifier = undefined
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
		if (this.FakeHook(hero)) {
			this.ClearTarget()
			return
		}
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
		const portal = aiming ? this.FindTeleportPortal(hero) : undefined
		if (portal !== undefined) {
			this.ClearTarget()
			if (!hero.IsChanneling && !hero.IsStunned && this.CanAct()) {
				this.AutoHookPortal(hero, portal)
			}
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

	private FakeHook(hero: Hero): boolean {
		const pressed = this.menu.FakeHookKey.isPressed

		if (this.fakeHookPending) {
			const pendingHook = hero.GetAbilityByClass(pudge_meat_hook)
			if (pendingHook !== undefined && pendingHook.IsInAbilityPhase) {
				const elapsed = Math.max(GameState.RawGameTime - pendingHook.CastStartTime, 0)
				const cancelAt = Math.max(pendingHook.CastPoint - GameState.TickInterval - FAKE_HOOK_CANCEL_SAFETY, 0)
				if (elapsed >= cancelAt) {
					hero.OrderStop()
					this.fakeHookPending = false
					this.fakeHookTime = 0
				}
				return true
			}
			if (GameState.RawGameTime - this.fakeHookTime > FAKE_HOOK_TIMEOUT) {
				this.fakeHookPending = false
				this.fakeHookTime = 0
			}
			return true
		}

		if (!pressed || hero.IsChanneling || hero.IsStunned || !this.CanAct()) {
			return false
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (!this.Ready(hook)) {
			return false
		}
		const target = this.AimTarget(hero)
		const point =
			target === undefined
				? InputManager.CursorOnWorld
				: this.predictor.Solve(hero, hook!, target, this.HookOptions()).point
		this.CastHookOrder(hero, hook!, point)
		this.LockCast(hook!)
		this.fakeHookPending = true
		this.fakeHookTime = GameState.RawGameTime
		return true
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
		if (!this.IsValidTarget(victim)) {
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

	private FindTeleportPortal(hero: Hero): IPortalTrack | undefined {
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (!this.Enabled(HOOK) || !this.Ready(hook)) {
			return undefined
		}
		const range = this.HookRange(hook!)
		const cursor = InputManager.CursorOnWorld
		let selected: IPortalTrack | undefined
		let closest = Number.MAX_VALUE
		for (const portal of this.portals.values()) {
			if (!this.ValidPortal(portal)) {
				continue
			}
			const destination = this.PortalDestination(portal)
			const hullRadius = portal.model.Caster?.HullRadius ?? 24
			if (hero.Position.Distance2D(destination) > range + hullRadius) {
				continue
			}
			const cursorDistance = destination.Distance2D(cursor)
			if (cursorDistance >= closest) {
				continue
			}
			closest = cursorDistance
			selected = portal
		}
		return selected
	}

	private ValidPortal(portal: IPortalTrack): boolean {
		const caster = portal.model.Caster
		if (caster !== undefined && (!caster.IsValid || !caster.IsAlive || !caster.IsEnemy())) {
			return false
		}
		return !portal.model.IsCanceled && portal.model.EndPosition.IsValid && this.PortalRemaining(portal) > 0
	}

	private PortalRemaining(portal: IPortalTrack): number {
		return portal.finishTime - GameState.RawGameTime
	}

	private PortalDestination(portal: IPortalTrack): Vector3 {
		const target = portal.model.Target
		if (target !== undefined && target.IsValid && target.IsAlive && target.IsMoving) {
			return target.GetPredictionPosition(Math.max(this.PortalRemaining(portal), 0))
		}
		return portal.model.EndPosition
	}

	private HookRange(hook: pudge_meat_hook): number {
		return hook.GetSpecialValue("hook_distance", hook.Level) || hook.CastRange || HOOK_RANGE_FALLBACK
	}

	// Zero delay: the first tick a solution clears the bar, the hook goes out.
	private AutoHook(hero: Hero, target: Hero): boolean {
		if (!this.Enabled(HOOK)) {
			return false
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (!this.Ready(hook)) {
			return false
		}
		const exitModifier = this.TimedExitModifier(target)
		if (exitModifier !== undefined) {
			return this.AutoHookExit(hero, hook!, target, exitModifier)
		}
		if (target.IsInvulnerable || target.IsUntargetable) {
			return false
		}
		const solution = this.predictor.Solve(hero, hook!, target, this.HookOptions())
		if (solution.reason !== "ok" || solution.blocked || solution.outOfRange || solution.chance < AUTO_HOOK_CHANCE) {
			return false
		}
		this.CastHook(hero, hook!, target, solution)
		return true
	}

	private TimedExitModifier(target: Hero): Modifier | undefined {
		for (const name of TIMED_EXIT_MODIFIERS) {
			const modifier = target.GetBuffByName(name)
			if (modifier !== undefined && modifier.RemainingTime > 0) {
				return modifier
			}
		}
		return undefined
	}

	private AutoHookExit(hero: Hero, hook: pudge_meat_hook, target: Hero, modifier: Modifier): boolean {
		const solution = this.ExitSolution(hero, hook, target, modifier)
		if (solution.reason !== "ok" || solution.blocked || solution.outOfRange) {
			return false
		}
		if (!this.TeleportHookWindow(solution, modifier.RemainingTime)) {
			return false
		}
		this.CastHook(hero, hook, target, solution, undefined, modifier)
		return true
	}

	private ExitSolution(
		hero: Hero,
		hook: pudge_meat_hook,
		target: Hero,
		modifier: Modifier,
		castDelay?: number
	): IHookSolution {
		const options = this.HookOptions(castDelay)
		if (modifier.Name === "modifier_disruptor_glimpse") {
			const backtrack = modifier.Ability?.GetSpecialValue("backtrack_time") || 4
			const destination = this.predictor.HistoricalPosition(target, backtrack)
			if (destination !== undefined) {
				return this.predictor.SolvePoint(hero, hook, target, destination, options)
			}
		}
		return this.predictor.SolveExit(hero, hook, target, modifier.RemainingTime, options)
	}

	private AutoHookPortal(hero: Hero, portal: IPortalTrack): boolean {
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (!this.Enabled(HOOK) || !this.Ready(hook) || !this.ValidPortal(portal)) {
			return false
		}
		const caster = portal.model.Caster
		const target = caster instanceof Hero ? caster : undefined
		const destination = this.PortalDestination(portal)
		const solution = this.predictor.SolvePoint(hero, hook!, caster, destination, this.HookOptions())
		if (solution.reason !== "ok" || solution.blocked || solution.outOfRange) {
			return false
		}
		if (!this.TeleportHookWindow(solution, this.PortalRemaining(portal))) {
			return false
		}
		this.CastHook(hero, hook!, target, solution, portal)
		return true
	}

	private TeleportHookWindow(solution: IHookSolution, remaining: number): boolean {
		const impactDelay = solution.totalTime
		const impactAfterArrival = impactDelay - remaining
		const earliest = Math.max(TELEPORT_ARRIVAL_HIT_DELAY - GameState.TickInterval * 0.25, 0.015)
		const latest = TELEPORT_ARRIVAL_HIT_DELAY + GameState.TickInterval * 1.5
		return impactAfterArrival >= earliest && impactAfterArrival <= latest
	}

	private Execute(hero: Hero, enemy: Hero): void {
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		const rot = hero.GetAbilityByClass(pudge_rot)
		const heap = hero.GetAbilityByName(FLESH_HEAP)
		const dismember = hero.GetAbilityByName(DISMEMBER)
		const distance = hero.Distance2D(enemy)
		const dragged = enemy === this.hookVictim
		const dismemberInRange =
			this.Enabled(DISMEMBER) && this.Ready(dismember) && this.InCastRange(hero, dismember!, enemy)
		const dismemberReady = dismemberInRange && this.Castable(dismember, enemy)

		if (!dragged && this.InitiateWithItem(hero, dismember, enemy, distance)) {
			return
		}
		const spellsSpent = !this.Ready(hook) && !this.Ready(dismember)
		if (this.UseItems(hero, enemy, distance, dismemberReady, spellsSpent, this.Ready(hook))) {
			return
		}
		if (this.Enabled(ROT) && rot !== undefined && this.RotInRadius(rot, distance) && this.EnableRot(hero, rot)) {
			return
		}
		if (this.Enabled(FLESH_HEAP) && this.CastHeap(hero, heap, distance)) {
			return
		}
		if (dismemberReady) {
			hero.CastTarget(dismember!, enemy)
			this.LockCast(dismember!)
			return
		}
		if (dragged) {
			return
		}
		if (!dismemberInRange && this.Enabled(HOOK) && this.Ready(hook) && this.ComboHook(hero, hook!, enemy)) {
			return
		}
		this.Attack(hero, enemy)
	}

	private InitiateWithItem(hero: Hero, dismember: Nullable<Ability>, enemy: Hero, distance: number): boolean {
		if (dismember !== undefined && this.InCastRange(hero, dismember, enemy)) {
			return false
		}

		const blink = this.FindItem(hero, "item_blink")
		if (
			this.ItemEnabled("item_blink") &&
			blink !== undefined &&
			blink.CanBeCasted() &&
			distance > BLINK_MIN_RANGE &&
			this.ItemInRange(hero, blink, "item_blink", enemy, distance)
		) {
			this.CastItem(hero, blink, "item_blink", enemy)
			return true
		}

		const harpoon = this.FindItem(hero, "item_harpoon")
		if (
			this.ItemEnabled("item_harpoon") &&
			harpoon !== undefined &&
			harpoon.CanBeCasted() &&
			!enemy.IsMagicImmune &&
			!enemy.IsInvulnerable &&
			!enemy.IsUntargetable &&
			this.ItemInRange(hero, harpoon, "item_harpoon", enemy, distance)
		) {
			this.CastItem(hero, harpoon, "item_harpoon", enemy)
			return true
		}
		return false
	}

	private UseItems(
		hero: Hero,
		enemy: Hero,
		distance: number,
		dismemberReady: boolean,
		spellsSpent: boolean,
		hookReady: boolean
	): boolean {
		if (enemy.HasBuffByName(LINKEN_MODIFIER)) {
			for (const name of LINKEN_BREAKERS) {
				if (this.TryItem(hero, enemy, name, distance, dismemberReady, spellsSpent, hookReady)) {
					return true
				}
			}
			return false
		}
		for (const name of ITEM_PRIORITY) {
			if (this.TryItem(hero, enemy, name, distance, dismemberReady, spellsSpent, hookReady)) {
				return true
			}
		}
		return false
	}

	private TryItem(
		hero: Hero,
		enemy: Hero,
		name: string,
		distance: number,
		dismemberReady: boolean,
		spellsSpent: boolean,
		hookReady: boolean
	): boolean {
		if (!this.ItemEnabled(name)) {
			return false
		}
		const item = this.FindItem(hero, name)
		if (item === undefined || !item.CanBeCasted()) {
			return false
		}
		if (!this.ItemInRange(hero, item, name, enemy, distance)) {
			return false
		}
		if (!this.ItemAllowed(name, item, hero, enemy, distance, dismemberReady, spellsSpent, hookReady)) {
			return false
		}
		this.CastItem(hero, item, name, enemy)
		return true
	}

	private ItemAllowed(
		name: string,
		item: Item,
		hero: Hero,
		enemy: Hero,
		distance: number,
		dismemberReady: boolean,
		spellsSpent: boolean,
		hookReady: boolean
	): boolean {
		if (this.TargetsEnemies(item) && (enemy.IsMagicImmune || enemy.IsInvulnerable || enemy.IsUntargetable)) {
			return false
		}
		switch (name) {
			case "item_soul_ring":
				return hero.ManaPercent <= SOUL_RING_MAX_MANA && hero.HPPercent > SOUL_RING_MIN_HP
			case "item_black_king_bar":
				return !hero.IsMagicImmune && distance <= ITEM_ENGAGE_RANGE && (dismemberReady || hero.HPPercent <= 70)
			case "item_sheepstick":
				return !enemy.IsHexed && !enemy.IsStunned
			case "item_abyssal_blade":
				return !enemy.IsStunned
			case "item_bloodthorn":
			case "item_orchid":
				return !enemy.IsSilenced
			case "item_nullifier":
				return (
					enemy.HasBuffByName(LINKEN_MODIFIER) ||
					enemy.Buffs.some(modifier => !modifier.IsDebuff() && modifier.IsDispellable)
				)
			case "item_rod_of_atos":
			case "item_gungir":
				return !enemy.IsRooted && !enemy.IsStunned
			case "item_shivas_guard":
				return distance <= (item.GetSpecialValue("blast_radius") || SHIVA_RADIUS_FALLBACK)
			case "item_bloodstone":
				return hero.HPPercent <= BLOODSTONE_MAX_HP && distance <= ITEM_ENGAGE_RANGE
			case "item_blade_mail":
				return hero.HPPercent <= 70 && distance <= ITEM_ENGAGE_RANGE
			case "item_pipe":
				return hero.HPPercent <= 75 && distance <= ITEM_ENGAGE_RANGE
			case "item_lotus_orb":
				return (
					distance <= ITEM_ENGAGE_RANGE &&
					(dismemberReady || hero.Buffs.some(modifier => modifier.IsDebuff() && modifier.IsDispellable))
				)
			case "item_heavens_halberd":
				return !enemy.IsDisarmed
			case "item_ethereal_blade":
				return !enemy.HasBuffByName(ETHEREAL_MODIFIER)
			case "item_dagon_5":
				return !this.EtherealPending(hero, enemy)
			case "item_spirit_vessel":
				return !enemy.HasBuffByName(VESSEL_MODIFIER)
			case "item_urn_of_shadows":
				return !enemy.HasBuffByName(URN_MODIFIER) && !enemy.HasBuffByName(VESSEL_MODIFIER)
			case "item_blink":
				return !hookReady && distance > BLINK_MIN_RANGE
			case "item_harpoon":
				return enemy.HasBuffByName(LINKEN_MODIFIER) || (!hookReady && distance > hero.GetAttackRange(enemy))
			case "item_armlet":
				return !item.IsToggled && distance <= ITEM_ENGAGE_RANGE
			case "item_ancient_janggo":
			case "item_boots_of_bearing":
				return distance > ITEM_CHASE_RANGE
			case "item_manta":
				return hero.IsSilenced || hero.IsRooted
			case "item_invis_sword":
			case "item_silver_edge":
				return !hookReady && distance > ITEM_CHASE_RANGE
			case "item_satanic":
				return hero.HPPercent <= SATANIC_MAX_HP && hero.IsInRange(enemy, hero.GetAttackRange(enemy))
			case "item_mask_of_madness":
				return spellsSpent && hero.IsInRange(enemy, hero.GetAttackRange(enemy))
			case "item_refresher":
				return spellsSpent
			case "item_vanguard":
				return false
			default:
				return true
		}
	}

	private ItemEnabled(name: string): boolean {
		return PUDGE_ITEMS.includes(name) && this.menu.Items.IsEnabled(name)
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

	private ItemInRange(hero: Hero, item: Item, name: string, enemy: Hero, distance: number): boolean {
		if (name === "item_blink") {
			return distance <= BLINK_MAX_RANGE + ITEM_ENGAGE_RANGE
		}
		if (
			!item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET) &&
			!item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)
		) {
			return true
		}
		if (item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET) && !this.TargetsEnemies(item)) {
			return true
		}
		const range = item.CastRange > 0 ? item.CastRange : ITEM_SELF_RANGE
		return hero.IsInRange(enemy, range)
	}

	private CastItem(hero: Hero, item: Item, name: string, enemy: Hero): void {
		if (name === "item_blink") {
			const distance = hero.Distance2D(enemy)
			const range = Math.min(item.CastRange || BLINK_MAX_RANGE, BLINK_MAX_RANGE)
			const travel = Math.min(Math.max(distance - DISMEMBER_RANGE_FALLBACK, 0), range)
			hero.CastPosition(item, hero.Position.Extend(enemy.Position, travel))
		} else if (item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET)) {
			hero.CastTarget(item, this.TargetsEnemies(item) ? enemy : hero)
		} else if (item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)) {
			const range = item.CastRange > 0 ? item.CastRange : ITEM_SELF_RANGE
			const point = hero.Distance2D(enemy) <= range ? enemy.Position : hero.Position.Extend(enemy.Position, range)
			hero.CastPosition(item, point)
		} else if (item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_TOGGLE)) {
			hero.CastToggle(item)
		} else {
			hero.CastNoTarget(item)
		}
		this.LockCast(item)
	}

	private TargetsEnemies(item: Item): boolean {
		return item.TargetTeamMask.hasMask(DOTA_UNIT_TARGET_TEAM.DOTA_UNIT_TARGET_TEAM_ENEMY)
	}

	private EtherealPending(hero: Hero, enemy: Hero): boolean {
		if (enemy.HasBuffByName(ETHEREAL_MODIFIER)) {
			return false
		}
		const ethereal = this.FindItem(hero, "item_ethereal_blade")
		return ethereal !== undefined && this.ItemEnabled("item_ethereal_blade") && ethereal.CanBeCasted()
	}

	private ComboHook(hero: Hero, hook: pudge_meat_hook, enemy: Hero): boolean {
		if (enemy.IsInvulnerable || enemy.IsUntargetable) {
			return false
		}
		const solution = this.predictor.Solve(hero, hook, enemy, this.HookOptions())
		if (
			solution.reason !== "ok" ||
			solution.blocked ||
			solution.outOfRange ||
			solution.chance < COMBO_HOOK_CHANCE
		) {
			return false
		}
		this.CastHook(hero, hook, enemy, solution)
		return true
	}

	private CastHook(
		hero: Hero,
		hook: pudge_meat_hook,
		target: Nullable<Hero>,
		solution: IHookSolution,
		portal?: IPortalTrack,
		exitModifier?: Modifier
	): void {
		this.CastHookOrder(hero, hook, solution.point)
		this.LockCast(hook)
		this.hookOrderPoint = solution.point
		this.hookOrderTarget = target
		this.hookOrderTime = GameState.RawGameTime
		this.hookTeleportTimed = portal !== undefined
		this.hookPortal = portal
		this.hookExitModifier = exitModifier
	}

	private CastHookOrder(hero: Hero, hook: pudge_meat_hook, point: Vector3): void {
		hero.CastPosition(hook, point)
	}

	// The ordered point is only a promise: while the cast animation plays the target can
	// still break off, and a hook that is already going to miss is worth more cancelled.
	private WatchHookCancel(hero: Hero): void {
		if (this.hookOrderPoint === undefined) {
			return
		}
		const hook = hero.GetAbilityByClass(pudge_meat_hook)
		if (hook === undefined) {
			this.hookOrderPoint = undefined
			this.hookOrderTarget = undefined
			this.hookTeleportTimed = false
			this.hookPortal = undefined
			this.hookExitModifier = undefined
			return
		}
		if (!hook.IsInAbilityPhase) {
			if (GameState.RawGameTime - this.hookOrderTime > HOOK_WATCH_GRACE) {
				this.hookOrderPoint = undefined
				this.hookTeleportTimed = false
				this.hookPortal = undefined
				this.hookExitModifier = undefined
			}
			return
		}
		const target = this.hookOrderTarget
		const portal = this.hookTeleportTimed ? this.hookPortal : undefined
		const exitModifier = this.hookExitModifier
		if (target === undefined && portal === undefined) {
			this.hookOrderPoint = undefined
			this.hookTeleportTimed = false
			this.hookPortal = undefined
			this.hookExitModifier = undefined
			return
		}
		const elapsed = Math.max(GameState.RawGameTime - hook.CastStartTime, 0)
		const remainingCast = Math.max(hook.CastPoint - elapsed, 0) + GameState.TickInterval
		if (portal !== undefined && portal.model.IsCanceled) {
			hero.OrderStop()
			this.hookOrderPoint = undefined
			this.hookOrderTarget = undefined
			this.hookTeleportTimed = false
			this.hookPortal = undefined
			this.hookExitModifier = undefined
			return
		}
		const solution =
			portal !== undefined
				? this.predictor.SolvePoint(
						hero,
						hook,
						portal.model.Caster ?? target,
						this.PortalDestination(portal),
						this.HookOptions(remainingCast)
				  )
				: exitModifier !== undefined && target !== undefined
				? exitModifier.IsValid && exitModifier.RemainingTime > 0
					? exitModifier.Name === "modifier_disruptor_glimpse"
						? this.predictor.SolvePoint(
								hero,
								hook,
								target,
								this.hookOrderPoint,
								this.HookOptions(remainingCast)
						  )
						: this.ExitSolution(hero, hook, target, exitModifier, remainingCast)
					: this.predictor.SolvePoint(hero, hook, target, target.Position, this.HookOptions(remainingCast))
				: this.predictor.Solve(hero, hook, target!, this.HookOptions(remainingCast))
		const destinationStable =
			(portal === undefined && exitModifier === undefined) ||
			solution.point.Distance2D(this.hookOrderPoint) <= this.predictor.Width(hook) + (target?.HullRadius ?? 24)
		if (solution.reason === "ok" && !solution.blocked && !solution.outOfRange && destinationStable) {
			return
		}
		hero.OrderStop()
		this.hookOrderPoint = undefined
		this.hookOrderTarget = undefined
		this.hookTeleportTimed = false
		this.hookPortal = undefined
		this.hookExitModifier = undefined
	}

	private HookOptions(castDelay?: number): IHookPredictOptions {
		return {
			allowForced: true,
			allowMoving: true,
			predictBlockers: true,
			castDelay
		}
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
		const trackHidden =
			enemy.HasBuffByName("modifier_slark_shadow_dance") ||
			enemy.HasBuffByName("modifier_slark_depth_shroud") ||
			this.TimedExitModifier(enemy) !== undefined
		return (
			enemy.IsValid &&
			enemy.LifeState === LifeState.LIFE_ALIVE &&
			(enemy.IsVisible || trackHidden) &&
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
		this.hookTeleportTimed = false
		this.hookPortal = undefined
		this.hookExitModifier = undefined
		this.fakeHookPending = false
		this.fakeHookTime = 0
		this.portals.clear()
		this.relocatePortals.clear()
		this.predictor.Reset()
		this.ClearTarget()
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.menu.AutoHookKey.isPressed = false
		this.menu.FakeHookKey.isPressed = false
		this.Reset()
	}
}
