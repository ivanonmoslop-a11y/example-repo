import {
	Ability,
	Color,
	DOTA_ABILITY_BEHAVIOR,
	DOTA_UNIT_TARGET_TEAM,
	DOTAGameState,
	DOTAGameUIState,
	dotaunitorder_t,
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
	ParticlesSDK,
	slark_dark_pact,
	slark_pounce,
	slark_saltwater_shiv,
	slark_shadow_dance,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { SLARK_ITEMS, SlarkMenu } from "./slark-menu"
import { predictPouncePoint } from "./slark-predict"

const SLARK_NAME = "npc_dota_hero_slark"
const DARK_PACT = "slark_dark_pact"
const POUNCE = "slark_pounce"
const SALTWATER_SHIV = "slark_saltwater_shiv"
const SHADOW_DANCE = "slark_shadow_dance"

const LINKEN_MODIFIER = "modifier_item_sphere_target"
const ETHEREAL_MODIFIER = "modifier_item_ethereal_blade_slow"
const URN_MODIFIER = "modifier_item_urn_damage"
const VESSEL_MODIFIER = "modifier_item_spirit_vessel_damage"

const ORDER_GUARD = 0
const ATTACK_GAP = 0
const POUNCE_REQUEST_TIMEOUT = 0.8
const POUNCE_FACING_ANGLE = 0.045
const POUNCE_SPEED_FALLBACK = 933
const POUNCE_RANGE_FALLBACK = 700
const BLINK_RANGE_FALLBACK = 1200
const ITEM_SELF_RANGE = 700
const ITEM_ENGAGE_RANGE = 700
const SHIVA_RADIUS_FALLBACK = 900
const TARGET_LINE_KEY = "heroes_combo_slark_target"
const TARGET_LINE_COLOR = new Color(255, 40, 40)

const ITEM_PRIORITY = [
	"item_sheepstick",
	"item_black_king_bar",
	"item_bloodthorn",
	"item_orchid",
	"item_nullifier",
	"item_rod_of_atos",
	"item_gungir",
	"item_abyssal_blade",
	"item_diffusal_blade",
	"item_disperser",
	"item_spirit_vessel",
	"item_urn_of_shadows",
	"item_veil_of_discord",
	"item_ethereal_blade",
	"item_heavens_halberd",
	"item_shivas_guard",
	"item_dagon_5",
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

interface IMovementTrack {
	current: IPositionSample
	previous?: IPositionSample
}

interface IPositionSample {
	position: Vector3
	time: number
}

interface IPounceRequest {
	ability: slark_pounce
	point: Vector3
	started: number
}

export class SlarkCombo {
	private readonly particles = new ParticlesSDK()
	private readonly tracks = new Map<number, IMovementTrack>()
	private pendingAbility: Nullable<Ability>
	private pendingTime = 0
	private lastAttackTime = 0
	private pounceRequest: Nullable<IPounceRequest>

	constructor(private readonly menu: SlarkMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("PrepareUnitOrders", this.PrepareUnitOrders.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<Hero> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid || !hero.IsAlive || hero.Name !== SLARK_NAME) {
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
		if (!this.menu.State.value || !this.InGame || hero === undefined) {
			this.Reset()
			return
		}

		this.UpdateMovementTracks()
		const combo = this.menu.ComboKey.isPressed
		const enemy = combo ? this.FindEnemy() : undefined
		this.DrawTarget(hero, enemy)
		if (this.ProcessPounceRequest(hero)) {
			return
		}
		if (!combo) {
			return
		}

		if (hero.IsStunned || hero.IsChanneling || !this.CanAct() || enemy === undefined) {
			return
		}
		this.Execute(hero, enemy)
	}

	private PrepareUnitOrders(order: ExecuteOrder): boolean {
		const hero = this.Hero
		if (!this.menu.State.value || hero === undefined || !order.IsPlayerInput) {
			return true
		}
		if (order.Issuers.length !== 0 && !order.Issuers.includes(hero)) {
			return true
		}

		const ability = order.Ability_
		if (
			this.menu.PounceToCursor.value &&
			order.OrderType === dotaunitorder_t.DOTA_UNIT_ORDER_CAST_NO_TARGET &&
			ability instanceof slark_pounce &&
			ability.Owner === hero
		) {
			if (ability.CanBeCasted()) {
				this.QueuePounce(ability, InputManager.CursorOnWorld)
				this.ProcessPounceRequest(hero)
			}
			return false
		}

		this.pounceRequest = undefined
		return true
	}

	private Execute(hero: Hero, enemy: Hero): void {
		const pounce = hero.GetAbilityByClass(slark_pounce)
		const darkPact = hero.GetAbilityByClass(slark_dark_pact)
		const saltwaterShiv = hero.GetAbilityByClass(slark_saltwater_shiv)
		const shadowDance = hero.GetAbilityByClass(slark_shadow_dance)
		const distance = hero.Distance2D(enemy)

		if (this.Enabled(SHADOW_DANCE) && this.Ready(shadowDance) && hero.HPPercent <= this.menu.ShadowDanceHP.value) {
			this.CastNoTarget(hero, shadowDance!)
			return
		}
		if (this.Initiate(hero, enemy, pounce, distance)) {
			return
		}
		if (this.Enabled(DARK_PACT) && this.Ready(darkPact) && distance <= this.PounceReach(pounce) + 200) {
			this.CastNoTarget(hero, darkPact!)
			return
		}
		if (this.ComboPounce(hero, enemy, pounce)) {
			return
		}
		if (this.ComboSaltwaterShiv(hero, enemy, saltwaterShiv)) {
			return
		}
		if (this.UseItems(hero, enemy, distance, pounce, darkPact, shadowDance)) {
			return
		}
		this.Attack(hero, enemy)
	}

	private QueuePounce(ability: slark_pounce, point: Vector3): void {
		this.pounceRequest = {
			ability,
			point: point.Clone(),
			started: GameState.RawGameTime
		}
	}

	private ProcessPounceRequest(hero: Hero): boolean {
		const request = this.pounceRequest
		if (request === undefined) {
			return false
		}
		const now = GameState.RawGameTime
		if (
			!request.ability.IsValid ||
			!request.ability.CanBeCasted() ||
			now - request.started > POUNCE_REQUEST_TIMEOUT
		) {
			this.pounceRequest = undefined
			return false
		}
		if (hero.IsStunned || hero.IsChanneling) {
			return true
		}

		if (hero.FindRotationAngle(request.point) <= POUNCE_FACING_ANGLE) {
			hero.CastNoTarget(request.ability)
			this.LockCast(request.ability)
			this.pounceRequest = undefined
			return true
		}
		hero.MoveToDirection(request.point)
		return true
	}

	private ComboPounce(hero: Hero, enemy: Hero, pounce: Nullable<slark_pounce>): boolean {
		if (!this.Enabled(POUNCE) || !this.Ready(pounce)) {
			return false
		}
		const velocity = this.TargetVelocity(enemy)
		const speed = pounce!.Speed || pounce!.GetBaseSpeedForLevel(pounce!.Level) || POUNCE_SPEED_FALLBACK
		const reach = this.PounceReach(pounce)
		const prediction = predictPouncePoint(
			hero.Position,
			enemy.Position,
			velocity,
			pounce!.ActivationDelay + GameState.InputLag + GameState.TickInterval,
			speed,
			reach + enemy.HullRadius
		)
		if (!prediction.reachable) {
			return false
		}
		this.QueuePounce(pounce!, new Vector3(prediction.point.x, prediction.point.y, prediction.point.z))
		return this.ProcessPounceRequest(hero)
	}

	private ComboSaltwaterShiv(hero: Hero, enemy: Hero, saltwaterShiv: Nullable<slark_saltwater_shiv>): boolean {
		if (!this.Enabled(SALTWATER_SHIV) || !this.Ready(saltwaterShiv)) {
			return false
		}
		const range = saltwaterShiv!.CastRange || hero.GetAttackRange(enemy)
		if (!hero.IsInRange(enemy, range)) {
			return false
		}
		hero.CastTarget(saltwaterShiv!, enemy)
		this.LockCast(saltwaterShiv!)
		return true
	}

	private Initiate(hero: Hero, enemy: Hero, pounce: Nullable<slark_pounce>, distance: number): boolean {
		const reach = this.PounceReach(pounce)
		const blink = this.FindItem(hero, "item_blink")
		if (
			this.ItemEnabled("item_blink") &&
			blink !== undefined &&
			blink.CanBeCasted() &&
			distance > reach &&
			distance <= (blink.CastRange || BLINK_RANGE_FALLBACK) + reach
		) {
			const blinkRange = blink.CastRange || BLINK_RANGE_FALLBACK
			const travel = Math.min(Math.max(distance - Math.min(reach * 0.7, 350), 0), blinkRange)
			hero.CastPosition(blink, hero.Position.Extend(enemy.Position, travel))
			this.LockCast(blink)
			return true
		}

		const harpoon = this.FindItem(hero, "item_harpoon")
		if (
			this.ItemEnabled("item_harpoon") &&
			harpoon !== undefined &&
			harpoon.CanBeCasted() &&
			!enemy.IsMagicImmune &&
			distance > hero.GetAttackRange(enemy) &&
			hero.IsInRange(enemy, harpoon.CastRange)
		) {
			hero.CastTarget(harpoon, enemy)
			this.LockCast(harpoon)
			return true
		}
		return false
	}

	private UseItems(
		hero: Hero,
		enemy: Hero,
		distance: number,
		pounce: Nullable<slark_pounce>,
		darkPact: Nullable<slark_dark_pact>,
		shadowDance: Nullable<slark_shadow_dance>
	): boolean {
		const names = enemy.HasBuffByName(LINKEN_MODIFIER) ? LINKEN_BREAKERS : ITEM_PRIORITY
		const spellsSpent = !this.Ready(pounce) && !this.Ready(darkPact) && !this.Ready(shadowDance)
		for (const name of names) {
			if (!this.ItemEnabled(name)) {
				continue
			}
			const item = this.FindItem(hero, name)
			if (
				item === undefined ||
				!item.CanBeCasted() ||
				!this.ItemInRange(hero, item, enemy, distance) ||
				!this.ItemAllowed(name, item, hero, enemy, distance, spellsSpent)
			) {
				continue
			}
			this.CastItem(hero, item, enemy)
			return true
		}
		return false
	}

	private ItemAllowed(
		name: string,
		item: Item,
		hero: Hero,
		enemy: Hero,
		distance: number,
		spellsSpent: boolean
	): boolean {
		if (this.TargetsEnemies(item) && (enemy.IsMagicImmune || enemy.IsInvulnerable || enemy.IsUntargetable)) {
			return false
		}
		switch (name) {
			case "item_blink":
			case "item_harpoon":
			case "item_vanguard":
				return false
			case "item_soul_ring":
				return hero.ManaPercent <= 50 && hero.HPPercent > 35
			case "item_black_king_bar":
				return !hero.IsMagicImmune && distance <= ITEM_ENGAGE_RANGE
			case "item_sheepstick":
				return !enemy.IsHexed && !enemy.IsStunned
			case "item_abyssal_blade":
				return !enemy.IsStunned
			case "item_bloodthorn":
			case "item_orchid":
				return !enemy.IsSilenced
			case "item_rod_of_atos":
			case "item_gungir":
				return !enemy.IsRooted && !enemy.IsStunned
			case "item_nullifier":
				return enemy.Buffs.some(modifier => !modifier.IsDebuff() && modifier.IsDispellable)
			case "item_ethereal_blade":
				return !enemy.HasBuffByName(ETHEREAL_MODIFIER)
			case "item_spirit_vessel":
				return !enemy.HasBuffByName(VESSEL_MODIFIER)
			case "item_urn_of_shadows":
				return !enemy.HasBuffByName(URN_MODIFIER) && !enemy.HasBuffByName(VESSEL_MODIFIER)
			case "item_shivas_guard":
				return distance <= (item.GetSpecialValue("blast_radius") || SHIVA_RADIUS_FALLBACK)
			case "item_satanic":
				return hero.HPPercent <= 40 && hero.IsInRange(enemy, hero.GetAttackRange(enemy))
			case "item_bloodstone":
			case "item_blade_mail":
			case "item_pipe":
				return hero.HPPercent <= 70 && distance <= ITEM_ENGAGE_RANGE
			case "item_lotus_orb":
				return hero.Buffs.some(modifier => modifier.IsDebuff() && modifier.IsDispellable)
			case "item_heavens_halberd":
				return !enemy.IsDisarmed
			case "item_manta":
				return hero.IsSilenced || hero.IsRooted
			case "item_armlet":
				return !item.IsToggled && distance <= ITEM_ENGAGE_RANGE
			case "item_mask_of_madness":
				return spellsSpent && hero.IsInRange(enemy, hero.GetAttackRange(enemy))
			case "item_refresher":
				return spellsSpent
			default:
				return true
		}
	}

	private CastItem(hero: Hero, item: Item, enemy: Hero): void {
		if (item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET)) {
			hero.CastTarget(item, this.TargetsEnemies(item) ? enemy : hero)
		} else if (item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)) {
			const range = item.CastRange || ITEM_SELF_RANGE
			const point = hero.IsInRange(enemy, range) ? enemy.Position : hero.Position.Extend(enemy.Position, range)
			hero.CastPosition(item, point)
		} else if (item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_TOGGLE)) {
			hero.CastToggle(item)
		} else {
			hero.CastNoTarget(item)
		}
		this.LockCast(item)
	}

	private CastNoTarget(hero: Hero, ability: Ability): void {
		hero.CastNoTarget(ability)
		this.LockCast(ability)
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

	private UpdateMovementTracks(): void {
		const now = GameState.RawGameTime
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!this.IsValidTarget(enemy)) {
				this.tracks.delete(enemy.Index)
				continue
			}
			const current = { position: enemy.Position.Clone(), time: now }
			const track = this.tracks.get(enemy.Index)
			this.tracks.set(enemy.Index, { current, previous: track?.current })
		}
	}

	private TargetVelocity(enemy: Hero): Vector3 | undefined {
		const track = this.tracks.get(enemy.Index)
		if (track?.previous === undefined) {
			return undefined
		}
		const elapsed = track.current.time - track.previous.time
		if (elapsed <= 0) {
			return undefined
		}
		return track.current.position.Subtract(track.previous.position).MultiplyScalar(1 / elapsed)
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
			!enemy.IsIllusion &&
			!enemy.IsInvulnerable &&
			!enemy.IsUntargetable
		)
	}

	private PounceReach(pounce: Nullable<slark_pounce>): number {
		return pounce === undefined ? POUNCE_RANGE_FALLBACK : pounce.Range || POUNCE_RANGE_FALLBACK
	}

	private Ready(ability: Nullable<Ability>): boolean {
		return ability !== undefined && ability.Level > 0 && ability.CanBeCasted()
	}

	private Enabled(name: string): boolean {
		return this.menu.Abilities.IsEnabled(name)
	}

	private ItemEnabled(name: string): boolean {
		return SLARK_ITEMS.includes(name) && this.menu.Items.IsEnabled(name)
	}

	private FindItem(hero: Hero, name: string): Nullable<Item> {
		return hero.Items.find(
			item =>
				item.Name === name ||
				(name === "item_blink" && item.Name.endsWith("blink")) ||
				(name === "item_dagon_5" && item.Name.startsWith("item_dagon"))
		)
	}

	private ItemInRange(hero: Hero, item: Item, enemy: Hero, distance: number): boolean {
		if (
			!item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET) &&
			!item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_POINT)
		) {
			return true
		}
		if (item.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET) && !this.TargetsEnemies(item)) {
			return true
		}
		const range = item.CastRange || ITEM_SELF_RANGE
		return distance <= range && hero.IsInRange(enemy, range)
	}

	private TargetsEnemies(item: Item): boolean {
		return item.TargetTeamMask.hasMask(DOTA_UNIT_TARGET_TEAM.DOTA_UNIT_TARGET_TEAM_ENEMY)
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
		this.pounceRequest = undefined
		this.tracks.clear()
		this.ClearTarget()
	}

	private GameEnded(): void {
		this.menu.ComboKey.isPressed = false
		this.Reset()
	}
}
