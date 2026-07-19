import {
	Ability,
	Color,
	DOTA_ABILITY_BEHAVIOR,
	DOTA_UNIT_TARGET_TEAM,
	DOTAGameState,
	DOTAGameUIState,
	EntityManager,
	EventsSDK,
	GameRules,
	GameState,
	Hero,
	LocalPlayer,
	ProjectileManager,
	RendererSDK,
	Sleeper,
	Unit
} from "github.com/octarine-public/wrapper/index"

import { CastMode, CounterSlot, CreateSlots } from "./counters"
import { AutoDisable, CreateDisableSlots, DISABLE_TRIGGER_AGE } from "./disable"
import { BlinkEscape } from "./escape"
import { MenuManager } from "./menu"
import { CreateMoveDodgeSlots, MoveDodge } from "./moveDodge"
import { DodgePanel } from "./panel"

const PROJ_MARGIN = 0.2
const CAST_MARGIN = 0.15
const CAST_RANGE_BUFFER = 250
const FACING_ANGLE = 0.45
const DODGE_SLEEP_MS = 600

interface Danger {
	isProjectile: boolean
	name: string
	timeLeft: number
	window: number
	projID?: number
}

new (class AutoDodge {
	private readonly menu = new MenuManager()
	private readonly slots = CreateSlots()
	private readonly moveSlots = CreateMoveDodgeSlots()
	private readonly disableSlots = CreateDisableSlots()
	private readonly panel = new DodgePanel(this.slots, this.moveSlots, this.disableSlots)
	private readonly escape = new BlinkEscape()
	private readonly moveDodge = new MoveDodge(this.moveSlots)
	private readonly autoDisable = new AutoDisable(this.disableSlots)
	private readonly sleeper = new Sleeper()
	private readonly handled = new Set<number>()
	private debugText = ""

	constructor() {
		this.menu.PanelKey.OnPressed(() => this.panel.Toggle())
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("Draw", this.Draw.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<Hero> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid) {
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
		this.debugText = ""
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			return
		}
		for (const counter of this.slots) {
			counter.Resolve(hero)
		}
		this.escape.Tick(hero, this.panel.blinkAway, this.panel.autoDisable)
		this.autoDisable.Tick(hero, this.panel.autoDisable, this.escape.BlinkTarget(hero, DISABLE_TRIGGER_AGE))
		this.moveDodge.moveDodgeEnabled = this.panel.moveDodgeEnabled
		this.moveDodge.blockControl = this.panel.blockControl
		this.moveDodge.Tick(hero)
		if (!hero.IsAlive) {
			return
		}
		const danger = this.FindDanger(hero)
		this.UpdateDebug(hero, danger)
		if (danger === undefined || danger.timeLeft > danger.window) {
			return
		}
		if (this.sleeper.Sleeping("dodge")) {
			return
		}
		if (hero.IsStunned || hero.IsHexed || hero.IsInvulnerable) {
			return
		}
		const slot = this.PickCounter(hero, danger)
		if (slot === undefined) {
			return
		}
		this.UseCounter(hero, slot, danger)
	}

	private FindDanger(hero: Hero): Nullable<Danger> {
		let best: Nullable<Danger>
		const alive = new Set<number>()
		const projs = ProjectileManager.AllTrackingProjectiles
		const projWindow = GameState.InputLag + PROJ_MARGIN
		for (const proj of projs) {
			alive.add(proj.ID)
			if (
				proj.Target !== hero ||
				proj.IsAttack ||
				!proj.IsDodgeable ||
				proj.IsDodged ||
				this.handled.has(proj.ID)
			) {
				continue
			}
			const source = proj.Source
			if (!(source instanceof Unit) || !source.IsEnemy(hero)) {
				continue
			}
			let timeLeft = 0
			if (proj.Position.IsValid) {
				const closing = proj.Speed + (hero.IsMoving ? hero.MoveSpeed : 0)
				timeLeft = proj.Position.Distance(hero.Position) / Math.max(closing, 1)
			}
			if (best === undefined || timeLeft < best.timeLeft) {
				best = {
					isProjectile: true,
					name: proj.Ability?.Name ?? "projectile",
					timeLeft,
					window: projWindow,
					projID: proj.ID
				}
			}
		}
		for (const id of this.handled) {
			if (!alive.has(id)) {
				this.handled.delete(id)
			}
		}
		const enemies = EntityManager.GetEntitiesByClass(Hero)
		for (const enemy of enemies) {
			if (!enemy.IsEnemy(hero) || !enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion) {
				continue
			}
			const danger = this.CastDanger(enemy, hero)
			if (danger !== undefined && (best === undefined || danger.timeLeft < best.timeLeft)) {
				best = danger
			}
		}
		return best
	}

	private CastDanger(enemy: Hero, hero: Hero): Nullable<Danger> {
		let best: Nullable<Danger>
		const castWindow = GameState.InputLag + CAST_MARGIN
		const lists: Nullable<Ability>[][] = [enemy.Spells, enemy.Items]
		for (const list of lists) {
			for (const abil of list) {
				if (abil === undefined || !abil.IsValid || !abil.IsInAbilityPhase) {
					continue
				}
				if (
					!abil.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET) ||
					!abil.HasTargetTeam(DOTA_UNIT_TARGET_TEAM.DOTA_UNIT_TARGET_TEAM_ENEMY) ||
					abil.Speed > 0
				) {
					continue
				}
				if (enemy.Distance(hero) > abil.CastRange + CAST_RANGE_BUFFER) {
					continue
				}
				if (enemy.FindRotationAngle(hero) > FACING_ANGLE) {
					continue
				}
				const elapsed = GameState.RawGameTime - abil.IsInAbilityPhaseChangeTime
				const timeLeft = Math.max(abil.CastPoint - elapsed, 0)
				if (best === undefined || timeLeft < best.timeLeft) {
					best = {
						isProjectile: false,
						name: abil.Name,
						timeLeft,
						window: castWindow
					}
				}
			}
		}
		return best
	}

	private PickCounter(hero: Hero, danger: Danger): Nullable<CounterSlot> {
		return this.slots.find(x => x.IsShown && x.Matches(danger.isProjectile) && x.CanUse(hero))
	}

	private UseCounter(hero: Hero, slot: CounterSlot, danger: Danger): void {
		const abil = slot.ability
		if (abil === undefined) {
			return
		}
		if (hero.IsChanneling && !this.panel.cancelAnimation) {
			return
		}
		if (this.panel.cancelAnimation && (hero.IsChanneling || hero.IsAttacking)) {
			hero.OrderStop(false)
		}
		if (slot.def.mode === CastMode.Self) {
			hero.CastTarget(abil, hero)
		} else {
			hero.CastNoTarget(abil)
		}
		this.sleeper.Sleep(DODGE_SLEEP_MS, "dodge")
		if (danger.projID !== undefined) {
			this.handled.add(danger.projID)
		}
	}

	private UpdateDebug(hero: Hero, danger: Nullable<Danger>): void {
		if (!this.menu.ShowDebug.value) {
			return
		}
		const state = this.sleeper.Sleeping("dodge") ? "cd" : "watch"
		const cancel = this.panel.cancelAnimation ? "cancel:on" : "cancel:off"
		let dangerText = "no danger"
		if (danger !== undefined) {
			const kind = danger.isProjectile ? "proj" : "cast"
			dangerText = `${kind} ${danger.name} ${Math.round(danger.timeLeft * 1000)}ms`
		}
		const slot = danger !== undefined ? this.PickCounter(hero, danger) : undefined
		const counter = slot !== undefined ? slot.def.key : "none"
		this.debugText = `${state} | ${dangerText} | ${counter} | ${cancel} | ${this.escape.Status} | ${this.moveDodge.Status} | ${this.autoDisable.Status}`
	}

	private Draw(): void {
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		this.panel.Draw()
		if (this.debugText.length === 0) {
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			return
		}
		const pos = RendererSDK.WorldToScreen(hero.RealPosition)
		if (pos === undefined) {
			return
		}
		RendererSDK.Text(this.debugText, pos, Color.White)
	}

	private GameEnded(): void {
		this.sleeper.FullReset()
		this.handled.clear()
		this.debugText = ""
		this.panel.Reset()
		this.escape.Reset()
		this.moveDodge.Reset()
		this.autoDisable.Reset()
	}
})()
