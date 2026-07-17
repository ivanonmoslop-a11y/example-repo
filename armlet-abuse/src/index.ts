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

/**
 * Armlet of Mordiggian abuse — the fast Paparazi off/on: both toggle orders in one
 * frame. CAST_TOGGLE bypasses the humanizer, so the "off" and the paired "on" go out
 * together and the hero is at 1 HP for only about a tick. The refill is arithmetic on
 * current HP (toggling off clamps the loss at 1, toggling on adds the bonus back), so
 * it works even same-tick.
 *
 * The rule is deliberately simple: whenever the armlet is on and HP is at or below the
 * threshold, burst — as early as the threshold, not once the hero is nearly dead. The
 * only things that can hold a burst back are the ones that would kill outright: an
 * Ice Blast shatter, being unable to toggle (stun / hex / item mute), or a known
 * poison tick that would land in the 1-HP window. Own attacks and movement are not a
 * factor — the fast toggle does not interrupt the hero's attack animation.
 *
 * The state machine guarantees one abuse = one off/on: a trigger is only evaluated in
 * Idle, firing moves to Bursting until the bonus is confirmed back, then Settling until
 * the HP gain has propagated. Nothing re-fires in between.
 */
const enum AbuseState {
	Idle,
	Bursting,
	Settling
}

/** Settling waits until at least this share of the bonus HP has actually arrived. */
const SETTLE_GAIN_FRACTION = 0.5

new (class ArmletAbuse {
	private readonly menu = new MenuManager()
	private readonly dot = new DotTracker()

	/** Bounds how long Bursting waits for the bonus before the safety net re-arms. */
	private readonly lock = new TickSleeper()
	/** Bounds how long Settling waits for the HP gain to become visible. */
	private readonly settle = new TickSleeper()

	private state = AbuseState.Idle
	private armlet: Nullable<item_armlet>
	/** HP seen the moment the bonus came back, -1 once the gain is visible. */
	private armHP = -1
	/** HP the refill must reach before Settling is considered done. */
	private settleTarget = 0
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

	/** Time an order needs to reach the server and be reflected back to us. */
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
		const cycle = this.CycleDuration(armlet)
		this.UpdateDebug(hero, bonusHP, cycle)

		// Mid-abuse: only advance the machine, never evaluate a fresh trigger.
		if (this.state === AbuseState.Bursting) {
			this.AdvanceBursting(hero, armlet, active)
			return
		}
		if (this.state === AbuseState.Settling) {
			if (this.HasSettled(hero)) {
				this.state = AbuseState.Idle
			}
			return
		}

		// Idle. Armlet off and the hero is low: arm it (pure upside — arming only
		// raises HP, it never drops to 1). Otherwise it is off on purpose; leave it.
		if (!active) {
			if (hero.HP <= this.Threshold(bonusHP) && this.CanToggle(hero)) {
				this.BeginToggleOn(hero, armlet)
			}
			return
		}
		// Armlet on: burst as soon as HP is at or below the threshold.
		if (this.ShouldAbuse(hero, bonusHP, cycle)) {
			this.BeginBurst(hero, armlet)
		}
	}

	private ShouldAbuse(hero: Unit, bonusHP: number, cycle: number): boolean {
		if (bonusHP <= 0 || !this.CanToggle(hero)) {
			return false
		}
		// Ice Blast shatters the hero the instant HP hits its kill threshold, and a
		// burst parks the hero at 1 HP — an outright death, never worth it.
		if (HasShatter(hero)) {
			return false
		}
		// The pool climbs for a tick or two after the bonus lands; judging a
		// half-applied HP reads as "still low" and bursts straight back down.
		if (!this.HasSettled(hero)) {
			return false
		}
		// A refill only gains HP below the bonus.
		if (hero.HP >= bonusHP) {
			return false
		}
		// The whole point: abuse at the threshold, not once nearly dead.
		if (hero.HP > this.Threshold(bonusHP)) {
			return false
		}
		// The only timing that matters: never park at 1 HP across a poison tick.
		// With no poison this is Infinity, so the burst fires immediately.
		return this.dot.NextTickTime() - GameState.RawGameTime > cycle
	}

	private AdvanceBursting(hero: Unit, armlet: item_armlet, active: boolean): void {
		// The burst is still in flight while the lock runs; the buff we can see is the
		// pre-burst one, so reading `active` now would settle early and double-fire.
		if (this.lock.Sleeping) {
			return
		}
		// Bonus is back — done.
		if (active) {
			this.EnterSettling(hero)
			return
		}
		// The item reads as on, the buff is just a tick behind: the "on" landed. A
		// resend here would flip it back off — wait for the buff instead.
		if (armlet.IsToggled) {
			return
		}
		// Genuinely still off after a generous wait: the "on" was lost. Re-send it.
		this.IssueToggle(hero, armlet)
		this.lock.Sleep(this.RoundTrip)
	}

	/** Fast path out of Bursting: the bonus modifier came back before the timeout. */
	private ModifierCreated(mod: Modifier): void {
		if (this.state !== AbuseState.Bursting || !this.IsOwnUnholyStrength(mod)) {
			return
		}
		this.EnterSettling(this.Hero)
	}

	private BeginBurst(hero: Unit, armlet: item_armlet): void {
		// Both toggle orders in one frame — the shortest possible 1-HP window.
		hero.CastToggle(armlet, false, false)
		hero.CastToggle(armlet, true, false)
		this.EnterBursting()
	}

	private BeginToggleOn(hero: Unit, armlet: item_armlet): void {
		this.IssueToggle(hero, armlet)
		this.EnterBursting()
	}

	private EnterBursting(): void {
		this.state = AbuseState.Bursting
		this.armHP = -1
		// Two round-trips: the off and the paired on go out, and the bonus modifier
		// makes the trip back. Long enough that a normal "on" has reflected before the
		// resend path is even considered. ModifierCreated ends Bursting sooner.
		this.lock.Sleep(2 * this.RoundTrip + GameState.TickInterval * 2000)
	}

	private EnterSettling(hero: Nullable<Unit>): void {
		this.state = AbuseState.Settling
		this.lock.ResetTimer()
		this.armHP = hero?.HP ?? -1
		const bonusHP = this.armlet !== undefined && this.armlet.IsValid ? this.GetBonusHP(this.armlet) : 0
		this.settleTarget = this.armHP + bonusHP * SETTLE_GAIN_FRACTION
		this.settle.Sleep(this.RoundTrip + GameState.TickInterval * 2000)
	}

	private HasSettled(hero: Unit): boolean {
		if (this.armHP < 0) {
			return true
		}
		if (hero.HP >= this.settleTarget || !this.settle.Sleeping) {
			this.armHP = -1
			return true
		}
		return false
	}

	private IssueToggle(hero: Unit, armlet: item_armlet): void {
		hero.CastToggle(armlet, false, false)
	}

	/** The stretch the hero can be stuck at 1 HP: the drop reaches the server, the
	 * toggle cooldown passes, and the re-arm makes the trip back. */
	private CycleDuration(armlet: item_armlet): number {
		return 2 * GameState.InputLag + armlet.ToggleCooldown + GameState.TickInterval
	}

	/** HP at or below which a burst fires. Capped at the bonus — a refill cannot take
	 * the hero above it, so a higher threshold would mean nothing. */
	private Threshold(bonusHP: number): number {
		const base =
			this.menu.ThresholdMode.SelectedID === MenuManager.MODE_MANUAL
				? this.menu.HPThreshold.value
				: this.PingThreshold()
		return Math.min(base, bonusHP)
	}

	/** Higher latency means a longer 1-HP window, so it triggers earlier with more
	 * pool to spare. Table supplied by the user. */
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

	/** Read from the item, not measured off max HP: a max-HP sample taken while the
	 * strength change is propagating reports only a fraction of the real bonus. */
	private GetBonusHP(armlet: item_armlet): number {
		return armlet.GetSpecialValue("unholy_bonus_strength") * GameData.HealthGainPerStrength
	}

	/** Hand the armlet back before going idle, so disabling the script mid-abuse never
	 * abandons the hero at 1 HP with the bonus still off. */
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
		this.armHP = -1
		this.settleTarget = 0
		this.lock.ResetTimer()
		this.settle.ResetTimer()
	}

	private UnitItemsChanged(unit: Unit): void {
		if (unit === LocalPlayer?.Hero) {
			this.armlet = undefined
		}
	}

	private UpdateDebug(hero: Unit, bonusHP: number, cycle: number): void {
		if (!this.menu.ShowDebug.value) {
			return
		}
		const tick = this.dot.NextTickTime() - GameState.RawGameTime
		const tickText = Number.isFinite(tick) ? `${Math.round(tick * 1000)}ms` : "none"
		this.debugText =
			`${this.StateName} | hp ${hero.HP}/${Math.round(this.Threshold(bonusHP))} of ${Math.round(bonusHP)}` +
			` | poison ${tickText} vs ${Math.round(cycle * 1000)}ms`
	}

	private get StateName(): string {
		switch (this.state) {
			case AbuseState.Bursting:
				return "bursting"
			case AbuseState.Settling:
				return "settling"
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
		this.armlet = undefined
		this.debugText = ""
	}
})()
