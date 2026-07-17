import {
	Color,
	DOTAGameState,
	DOTAGameUIState,
	EventsSDK,
	GameData,
	GameRules,
	GameState,
	item_armlet,
	LocalPlayer,
	Modifier,
	RendererSDK,
	TickSleeper,
	Unit
} from "github.com/octarine-public/wrapper/index"

import { HasShatter } from "./debuffs"
import { DotTracker } from "./dot"
import { MenuManager } from "./menu"
import { ThreatTracker } from "./threats"

const RAMP_DURATION = 0.6
const RAMP_MARGIN = 0.1

const enum AbuseState {
	Idle,
	Bursting,
	Ramping
}

new (class ArmletAbuse {
	private readonly menu = new MenuManager()
	private readonly dot = new DotTracker()
	private readonly threats = new ThreatTracker()

	private readonly lock = new TickSleeper()
	private readonly rampSleep = new TickSleeper()

	private state = AbuseState.Idle
	private armlet: Nullable<item_armlet>
	private debugText = ""

	constructor() {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("ModifierCreated", this.ModifierCreated.bind(this))
		EventsSDK.on("UnitItemsChanged", this.UnitItemsChanged.bind(this))
		EventsSDK.on("Draw", this.Draw.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<Unit> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid || !hero.IsAlive) {
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

	private get RoundTrip(): number {
		return (GameState.InputLag + GameState.IOLag) * 1000
	}

	private PostDataUpdate(): void {
		this.debugText = ""
		if (!this.menu.State.value || !this.InGame) {
			this.Restore()
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			this.Reset()
			return
		}
		const armlet = this.GetArmlet(hero)
		if (armlet === undefined) {
			this.Reset()
			return
		}

		const active = hero.HasBuffByName(item_armlet.ModifierName)
		const bonusHP = this.GetBonusHP(armlet)
		this.UpdateDebug(hero, bonusHP)

		if (this.state === AbuseState.Bursting) {
			this.AdvanceBursting(hero, armlet, active)
			return
		}
		if (this.state === AbuseState.Ramping) {
			if (!this.rampSleep.Sleeping) {
				this.state = AbuseState.Idle
			}
			return
		}

		if (!active) {
			if (hero.HP <= this.Threshold(bonusHP) && this.CanToggle(hero)) {
				this.ToggleOn(hero, armlet)
			}
			return
		}
		if (this.ShouldAbuse(hero, bonusHP)) {
			this.Burst(hero, armlet)
		}
	}

	private ShouldAbuse(hero: Unit, bonusHP: number): boolean {
		if (bonusHP <= 0 || !this.CanToggle(hero)) {
			return false
		}
		if (HasShatter(hero)) {
			return false
		}
		if (hero.HP >= bonusHP) {
			return false
		}
		if (hero.HP > this.Threshold(bonusHP)) {
			return false
		}

		const cycle = this.CycleDuration()
		const now = GameState.RawGameTime

		if (this.dot.NextTickTime() - now <= cycle) {
			return false
		}

		const threatETA = this.threats.EarliestThreatTime(hero)
		if (threatETA - now <= cycle) {
			return false
		}

		return true
	}

	private CycleDuration(): number {
		return GameState.InputLag + 2 * GameState.TickInterval
	}

	private AdvanceBursting(hero: Unit, armlet: item_armlet, active: boolean): void {
		if (this.lock.Sleeping) {
			return
		}
		if (active) {
			this.EnterRamping()
			return
		}
		if (armlet.IsToggled) {
			return
		}
		this.IssueToggle(hero, armlet)
		this.lock.Sleep(this.RoundTrip)
	}

	private ModifierCreated(mod: Modifier): void {
		if (this.state !== AbuseState.Bursting || !this.IsOwnUnholyStrength(mod)) {
			return
		}
		this.EnterRamping()
	}

	private Burst(hero: Unit, armlet: item_armlet): void {
		hero.CastToggle(armlet, false, false)
		hero.CastToggle(armlet, true)
		this.state = AbuseState.Bursting
		this.lock.Sleep(2 * this.RoundTrip + GameState.TickInterval * 2000)
	}

	private ToggleOn(hero: Unit, armlet: item_armlet): void {
		this.IssueToggle(hero, armlet)
		this.state = AbuseState.Bursting
		this.lock.Sleep(2 * this.RoundTrip + GameState.TickInterval * 2000)
	}

	private EnterRamping(): void {
		this.state = AbuseState.Ramping
		this.lock.ResetTimer()
		this.rampSleep.Sleep((RAMP_DURATION + RAMP_MARGIN) * 1000)
	}

	private IssueToggle(hero: Unit, armlet: item_armlet): void {
		hero.CastToggle(armlet, false, false)
	}

	private Threshold(bonusHP: number): number {
		const base =
			this.menu.ThresholdMode.SelectedID === MenuManager.MODE_MANUAL
				? this.menu.HPThreshold.value
				: this.PingThreshold()
		return Math.min(base, bonusHP)
	}

	private PingThreshold(): number {
		const ping = GameState.Ping
		if (ping < 30) {
			return 200
		}
		if (ping <= 50) {
			return 250
		}
		if (ping <= 70) {
			return 300
		}
		if (ping <= 100) {
			return 400
		}
		return 500
	}

	private CanToggle(hero: Unit): boolean {
		if (hero.IsStunned || hero.IsHexed || hero.IsMuted) {
			return false
		}
		return this.armlet !== undefined && this.armlet.IsValid && !this.armlet.IsMuted
	}

	private IsOwnUnholyStrength(mod: Modifier): boolean {
		return mod.Name === item_armlet.ModifierName && mod.Parent === LocalPlayer?.Hero
	}

	private GetArmlet(hero: Unit): Nullable<item_armlet> {
		if (this.armlet !== undefined && this.armlet.IsValid) {
			return this.armlet
		}
		this.armlet = hero.Items.find((item): item is item_armlet => item instanceof item_armlet)
		return this.armlet
	}

	private GetBonusHP(armlet: item_armlet): number {
		return armlet.GetSpecialValue("unholy_bonus_strength") * GameData.HealthGainPerStrength
	}

	private Restore(): void {
		const hero = this.Hero
		if (this.state !== AbuseState.Bursting || hero === undefined || this.armlet === undefined) {
			this.Reset()
			return
		}
		if (!hero.HasBuffByName(item_armlet.ModifierName)) {
			this.IssueToggle(hero, this.armlet)
		}
		this.Reset()
	}

	private Reset(): void {
		this.state = AbuseState.Idle
		this.lock.ResetTimer()
		this.rampSleep.ResetTimer()
	}

	private UnitItemsChanged(unit: Unit): void {
		if (unit === LocalPlayer?.Hero) {
			this.armlet = undefined
		}
	}

	private UpdateDebug(hero: Unit, bonusHP: number): void {
		if (!this.menu.ShowDebug.value) {
			return
		}
		const now = GameState.RawGameTime
		const dotTick = this.dot.NextTickTime() - now
		const dotText = Number.isFinite(dotTick) ? `${Math.round(dotTick * 1000)}ms` : "none"
		const cycle = this.CycleDuration()
		const threatETA = this.threats.EarliestThreatTime(hero) - now
		const threatText = Number.isFinite(threatETA) ? `${Math.round(threatETA * 1000)}ms` : "none"
		const rampLeft = this.rampSleep.Sleeping ? Math.round(this.rampSleep.RemainingSleepTime) : 0
		const incoming = Math.round(this.threats.TotalIncomingDamage(hero, cycle + RAMP_DURATION))
		this.debugText =
			`${this.StateName} | hp ${hero.HP}/${Math.round(this.Threshold(bonusHP))}` +
			` | dot ${dotText} | threat ${threatText}` +
			` | dmg ${incoming} | ramp ${rampLeft}ms`
	}

	private get StateName(): string {
		switch (this.state) {
			case AbuseState.Bursting:
				return "burst"
			case AbuseState.Ramping:
				return "ramp"
			default:
				return "idle"
		}
	}

	private Draw(): void {
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
		this.Reset()
		this.dot.Reset()
		this.threats.Reset()
		this.armlet = undefined
		this.debugText = ""
	}
})()
