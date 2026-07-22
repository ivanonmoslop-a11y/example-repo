import {
	Ability,
	EntityManager,
	EventsSDK,
	FakeUnit,
	Fountain,
	GameState,
	Hero,
	item_blink,
	LocalPlayer,
	NetworkedParticle,
	Sleeper,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

const TRIGGER_RADIUS = 1000
// Shortest hop worth reacting to. Blink dagger lands 1200 away; gap closers with a
// travel animation still cover several hundred units in one tick.
const BLINK_MIN_DISTANCE = 350
const APPROACH_MIN = 200
const MAX_WALK_SPEED = 650
const WALK_MARGIN = 120
const CONTINUOUS_GAP = 0.35
const APPROACH_INFO_TTL = 3
const RECENT_CAST_SLACK = 2.5
const MIN_GAP_COOLDOWN = 5
const CAST_FRESH = 0.35
const REVEAL_WINDOW = 0.6
const REVEAL_CD_SLACK = 1.5
const BLINK_MARK_TTL = 2
const BLINK_MARK_DIST = 450
const BLINK_MARK_TIME = 0.75
const ALLY_NEAR = 250
const PENDING_TIME = 0.5
const RETRIGGER_MS = 1000
const SELF_BLINK_TIME = 0.6
const SAFE_MIN_DIST = 600
const CANDIDATES = 16
const FOUNTAIN_BONUS = 150
// Our own Meat Hook drags a fogged enemy several hundred units toward us in one tick,
// which is indistinguishable from a blink-in. Blinking away from a target we just
// hooked throws the hook away, so that target is muted while the drag lasts.
const HOOK_MODIFIER = "modifier_pudge_meat_hook"
const HOOK_IMMUNE_TIME = 1.5

const GAP_CLOSERS = new Set([
	"antimage_blink",
	"queenofpain_blink",
	"riki_blink_strike",
	"mirana_leap",
	"slark_pounce",
	"faceless_void_time_walk",
	"morphling_waveform",
	"earth_spirit_rolling_boulder",
	"phoenix_icarus_dive",
	"void_spirit_astral_step",
	"spectre_reality",
	"spectre_haunt",
	"magnataur_skewer",
	"tusk_snowball",
	"marci_rebound",
	"pangolier_swashbuckle",
	"puck_illusory_orb",
	"puck_ethereal_jaunt",
	"sandking_burrowstrike",
	"vengefulspirit_nether_swap",
	"primal_beast_onslaught",
	"dawnbreaker_converge",
	"io_relocate"
])

interface EnemyTrack {
	pos: Vector3
	time: number
	prevPos: Vector3
	prevTime: number
}

interface RevealCandidate {
	enemy: Hero
	revealPos: Vector3
	revealTime: number
	preFogPos: Nullable<Vector3>
	preFogTime: number
}

interface BlinkMark {
	pos: Vector3
	time: number
}

export class BlinkEscape {
	private enabled = true
	private detect = true
	private pendingUntil = 0
	private lastTriggerTime = 0
	private readonly lastTriggerPos = new Vector3().Invalidate()
	private readonly jumpers = new Map<number, number>()
	private selfBlinkUntil = 0
	private prevOwnCooldown = 0
	private reason = "none"
	private blink: Nullable<item_blink>
	private readonly sleeper = new Sleeper()
	private readonly tracks = new Map<number, EnemyTrack>()
	private readonly reveals = new Map<number, RevealCandidate>()
	private readonly marks: BlinkMark[] = []
	private readonly events: { text: string; time: number }[] = []
	private readonly consumed = new Set<number>()
	private readonly hooked = new Map<number, number>()

	constructor() {
		EventsSDK.on("ParticleCreated", particle => this.OnParticle(particle))
		EventsSDK.on("ParticleUpdated", particle => this.OnParticle(particle))
		EventsSDK.on("ParticleUnitPositionUpdated", (unit, particle) => this.OnUnitReveal(unit, particle))
		EventsSDK.on("StartSound", (name, source, position) => this.OnSound(name, source, position))
	}

	public get DebugLines(): string[] {
		const now = GameState.RawGameTime
		return this.events.map(x => `${(now - x.time).toFixed(1)} ${x.text}`)
	}

	public BlinkTargets(hero: Hero, maxAge: number): Hero[] {
		const now = GameState.RawGameTime
		for (const [index, time] of this.jumpers) {
			if (now - time > maxAge) {
				this.jumpers.delete(index)
			}
		}
		const enemies = EntityManager.GetEntitiesByClass(Hero).filter(
			x => x.IsValid && x.IsAlive && x.IsVisible && !x.IsIllusion && x.IsEnemy(hero)
		)
		const targets = enemies.filter(x => this.jumpers.has(x.Index))
		if (targets.length !== 0) {
			return targets.sort((a, b) => a.Distance2D(hero) - b.Distance2D(hero))
		}
		if (this.lastTriggerTime <= 0 || now - this.lastTriggerTime > maxAge) {
			return []
		}
		const from = this.lastTriggerPos.IsValid ? this.lastTriggerPos : hero.Position
		const nearest = this.NearestEnemyTo(from)
		return nearest !== undefined ? [nearest] : []
	}

	public get Status(): string {
		if (!this.enabled) {
			return "esc:off"
		}
		if (this.blink === undefined || !this.blink.IsValid) {
			return "esc:no-blink"
		}
		if (this.pendingUntil > GameState.RawGameTime) {
			return `esc:cast(${this.reason})`
		}
		if (this.sleeper.Sleeping("escape")) {
			return `esc:cd(${this.reason})`
		}
		return "esc:watch"
	}

	public Tick(hero: Hero, enabled: boolean, detect: boolean = enabled): void {
		this.enabled = enabled
		this.detect = enabled || detect
		this.ResolveBlink(hero)
		this.TrackOwnBlink()
		this.UpdateHooked(hero)
		this.WatchEnemies(hero)
		this.EvaluateReveals(hero)
		if (!this.enabled || !hero.IsAlive) {
			this.pendingUntil = 0
			return
		}
		if (this.pendingUntil <= GameState.RawGameTime) {
			return
		}
		const blink = this.blink
		if (blink === undefined || !blink.IsValid) {
			return
		}
		const dest = this.PickDestination(hero, blink.CastRange)
		hero.CastPosition(blink, dest, false, false)
	}

	public Reset(): void {
		this.pendingUntil = 0
		this.selfBlinkUntil = 0
		this.prevOwnCooldown = 0
		this.reason = "none"
		this.blink = undefined
		this.sleeper.FullReset()
		this.tracks.clear()
		this.reveals.clear()
		this.jumpers.clear()
		this.marks.length = 0
		this.events.length = 0
		this.consumed.clear()
		this.hooked.clear()
	}

	private get Hero(): Nullable<Hero> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid) {
			return undefined
		}
		return hero
	}

	private ResolveBlink(hero: Hero): void {
		if (this.blink !== undefined && this.blink.IsValid) {
			return
		}
		this.blink = hero.Items.find((x): x is item_blink => x instanceof item_blink)
	}

	private WatchEnemies(hero: Hero): void {
		const now = GameState.RawGameTime
		const heroPos = hero.Position
		const active = this.detect && hero.IsAlive
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsEnemy(hero) || enemy.IsIllusion) {
				continue
			}
			if (!enemy.IsAlive) {
				this.tracks.delete(enemy.Index)
				this.reveals.delete(enemy.Index)
				continue
			}
			if (!enemy.IsVisible) {
				continue
			}
			const cur = enemy.Position.Clone()
			const track = this.tracks.get(enemy.Index)
			if (this.hooked.has(enemy.Index)) {
				this.reveals.delete(enemy.Index)
				this.Track(enemy.Index, track, cur, now)
				continue
			}
			const inRange = active && cur.Distance2D(heroPos) <= TRIGGER_RADIUS
			if (inRange && (track === undefined || now - track.time > CONTINUOUS_GAP)) {
				this.reveals.set(enemy.Index, {
					enemy,
					preFogPos: track?.pos,
					preFogTime: track?.time ?? 0,
					revealPos: cur,
					revealTime: now
				})
			}
			const reason = inRange ? this.ThreatReason(enemy, track, cur, heroPos, now) : undefined
			this.Track(enemy.Index, track, cur, now)
			if (reason !== undefined) {
				this.Trigger(reason, cur, enemy)
			}
		}
	}

	private Track(index: number, track: Nullable<EnemyTrack>, cur: Vector3, now: number): void {
		if (track === undefined) {
			this.tracks.set(index, { pos: cur, prevPos: cur, prevTime: now, time: now })
			return
		}
		track.prevPos = track.pos
		track.prevTime = track.time
		track.pos = cur
		track.time = now
	}

	// Only a blink counts. An enemy merely walking out of the fog, or standing next to
	// us when we first see him, is not a jump — the old "new"/"fog" reasons burned the
	// dagger on every laner who stepped into the trees.
	private ThreatReason(
		enemy: Hero,
		track: Nullable<EnemyTrack>,
		cur: Vector3,
		heroPos: Vector3,
		now: number
	): Nullable<string> {
		if (track === undefined) {
			return undefined
		}
		const closed = track.pos.Distance2D(heroPos) - cur.Distance2D(heroPos)
		if (closed < APPROACH_MIN) {
			return undefined
		}
		// Measured on actual displacement, not on ground closed toward us: a hero
		// strafing sideways at full speed closes little but travels far, and only the
		// travel distinguishes a teleport from a sprint.
		const gap = now - track.time
		const moved = track.pos.Distance2D(cur)
		if (gap <= CONTINUOUS_GAP && moved >= BLINK_MIN_DISTANCE && moved > gap * MAX_WALK_SPEED + WALK_MARGIN) {
			return "jump"
		}
		return this.JustUsedGapCloser(enemy, now) ? "cd" : undefined
	}

	// A fogged enemy's abilities are PVS-culled, so the proof of a blink (cooldown
	// value, arrival particle) often lands a tick or two after the reveal — candidates
	// stay alive for a few ticks instead of checking only the reveal tick.
	private EvaluateReveals(hero: Hero): void {
		const now = GameState.RawGameTime
		while (this.marks.length > 0 && now - this.marks[0].time > BLINK_MARK_TTL) {
			this.marks.shift()
		}
		for (const [index, cand] of this.reveals) {
			if (this.hooked.has(index)) {
				this.reveals.delete(index)
				continue
			}
			if (now - cand.revealTime > REVEAL_WINDOW || !cand.enemy.IsValid || !cand.enemy.IsAlive) {
				this.reveals.delete(index)
				continue
			}
			const reason = this.RevealReason(cand)
			if (reason === undefined) {
				continue
			}
			this.reveals.delete(index)
			if (this.IsApproachingReveal(cand, hero.Position)) {
				this.Trigger(reason, cand.revealPos, cand.enemy)
			}
		}
	}

	private RevealReason(cand: RevealCandidate): Nullable<string> {
		if (this.JustUsedGapCloserAt(cand.enemy, cand.revealTime)) {
			return "fog-cd"
		}
		if (this.HasMarkNear(cand.revealPos, cand.revealTime)) {
			return "fog-part"
		}
		if (cand.preFogPos === undefined) {
			return undefined
		}
		// The walk allowance stays bounded: past APPROACH_INFO_TTL a fog gap excuses any
		// distance and a blink becomes indistinguishable from walking client-side.
		const gap = cand.revealTime - cand.preFogTime
		const moved = cand.preFogPos.Distance2D(cand.revealPos)
		if (gap <= APPROACH_INFO_TTL && moved >= BLINK_MIN_DISTANCE && moved > gap * MAX_WALK_SPEED + WALK_MARGIN) {
			return "fog-move"
		}
		return undefined
	}

	private HasMarkNear(pos: Vector3, revealTime: number): boolean {
		return this.marks.some(
			x => Math.abs(x.time - revealTime) <= BLINK_MARK_TIME && x.pos.Distance2D(pos) <= BLINK_MARK_DIST
		)
	}

	private RecordBlink(pos: Vector3): void {
		this.marks.push({ pos: pos.Clone(), time: GameState.RawGameTime })
		if (this.marks.length > 32) {
			this.marks.shift()
		}
	}

	private IsApproachingReveal(cand: RevealCandidate, heroPos: Vector3): boolean {
		if (cand.preFogPos === undefined || cand.revealTime - cand.preFogTime > APPROACH_INFO_TTL) {
			return true
		}
		return cand.preFogPos.Distance2D(heroPos) - cand.revealPos.Distance2D(heroPos) >= APPROACH_MIN
	}

	private JustUsedGapCloserAt(enemy: Hero, revealTime: number): boolean {
		const blink = enemy.GetItemByClass(item_blink)
		if (blink !== undefined && this.JustCastAt(blink, revealTime)) {
			return true
		}
		return enemy.Spells.some(
			x => x !== undefined && x.IsValid && GAP_CLOSERS.has(x.Name) && this.JustCastAt(x, revealTime)
		)
	}

	private JustCastAt(abil: Ability, revealTime: number): boolean {
		if (abil.Cooldown <= 0 || abil.MaxCooldown < MIN_GAP_COOLDOWN) {
			return false
		}
		if (abil.CooldownChangeTime < revealTime - CAST_FRESH) {
			return false
		}
		return abil.Cooldown >= abil.MaxCooldown - REVEAL_CD_SLACK
	}

	private JustUsedGapCloser(enemy: Hero, now: number): boolean {
		const blink = enemy.GetItemByClass(item_blink)
		if (blink !== undefined && this.JustCast(blink, now)) {
			return true
		}
		return enemy.Spells.some(x => x !== undefined && x.IsValid && GAP_CLOSERS.has(x.Name) && this.JustCast(x, now))
	}

	private JustCast(abil: Ability, now: number): boolean {
		if (abil.Cooldown <= 0 || abil.MaxCooldown < MIN_GAP_COOLDOWN) {
			return false
		}
		if (now - abil.CooldownChangeTime > CAST_FRESH) {
			return false
		}
		return abil.Cooldown >= abil.MaxCooldown - RECENT_CAST_SLACK
	}

	// particle === undefined means the particle's path hash is unknown to the wrapper
	// (econ blink skins missing from its table create no NetworkedParticle instance),
	// so the path filter is impossible — but ANY particle positioning a fogged enemy
	// inside our vision is an arrival effect: fogged units' ambient particles are not
	// networked at all.
	private OnUnitReveal(unit: FakeUnit | Unit, particle: Nullable<NetworkedParticle>): void {
		if (!this.detect || (particle !== undefined && !this.IsBlinkArrival(particle))) {
			return
		}
		const hero = this.Hero
		if (hero === undefined || !hero.IsAlive) {
			return
		}
		if (unit instanceof Unit && (!unit.IsEnemy(hero) || unit.IsIllusion)) {
			return
		}
		const pos = unit.PredictedPosition
		if (!pos.IsValid) {
			return
		}
		const dist = pos.Distance2D(hero.Position)
		if (particle === undefined) {
			this.Log(`upos ${this.ShortName(unit)} d${Math.round(dist)}`)
			if (unit instanceof Unit && unit.IsVisible) {
				return
			}
		}
		if (dist > TRIGGER_RADIUS) {
			return
		}
		this.RecordBlink(pos)
		if (unit instanceof Unit && !this.IsApproachingPos(unit.Index, pos, hero.Position)) {
			return
		}
		this.Trigger(particle === undefined ? "upos" : "particle", pos, unit instanceof Hero ? unit : undefined)
	}

	private OnSound(name: string, source: Nullable<FakeUnit | Unit>, position: Vector3): void {
		if (!this.detect || !name.toLowerCase().includes("blink")) {
			return
		}
		const hero = this.Hero
		if (hero === undefined || !hero.IsAlive) {
			return
		}
		if (source instanceof Unit && (!source.IsEnemy(hero) || source.IsIllusion)) {
			return
		}
		if (!position.IsValid || position.IsZero()) {
			return
		}
		const dist = position.Distance2D(hero.Position)
		this.Log(`snd ${name} d${Math.round(dist)}`)
		if (dist > TRIGGER_RADIUS) {
			return
		}
		this.RecordBlink(position)
		if (source instanceof Unit && !this.IsApproachingPos(source.Index, position, hero.Position)) {
			return
		}
		if (name.toLowerCase().includes("blink_in")) {
			this.Trigger("snd", position, source instanceof Hero ? source : undefined)
		}
	}

	private ShortName(unit: FakeUnit | Unit): string {
		const name = unit instanceof Unit ? unit.Name : unit.Name || "fake"
		return name.replace("npc_dota_hero_", "")
	}

	private Log(text: string): void {
		this.events.push({ text, time: GameState.RawGameTime })
		if (this.events.length > 6) {
			this.events.shift()
		}
	}

	private OnParticle(particle: NetworkedParticle): void {
		if (!this.detect || this.consumed.has(particle.Index) || !this.IsBlinkArrival(particle)) {
			return
		}
		const hero = this.Hero
		if (hero === undefined || !hero.IsAlive) {
			return
		}
		const attached = particle.AttachedTo ?? particle.ModifiersAttachedTo
		if (attached !== undefined) {
			this.HandleAttached(particle, attached, hero)
			return
		}
		const cp = this.ParticlePosition(particle)
		if (cp === undefined) {
			return
		}
		this.Consume(particle.Index)
		if (cp.Distance2D(hero.Position) > TRIGGER_RADIUS) {
			return
		}
		const source = particle.Source
		if (source !== undefined) {
			if (!source.IsEnemy(hero)) {
				return
			}
			this.RecordBlink(cp)
			if (!this.IsApproachingPos(source.Index, cp, hero.Position)) {
				return
			}
			this.Trigger("particle", cp, source instanceof Hero ? source : undefined)
			return
		}
		if (this.IsOwnBlink(cp, hero)) {
			return
		}
		this.RecordBlink(cp)
		if (this.HasAllyNear(cp, hero)) {
			return
		}
		this.Trigger("particle", cp)
	}

	private HandleAttached(particle: NetworkedParticle, attached: FakeUnit | Unit, hero: Hero): void {
		if (attached instanceof Unit && (!attached.IsEnemy(hero) || attached.IsIllusion)) {
			this.Consume(particle.Index)
			return
		}
		const pos = attached.PredictedPosition
		if (!pos.IsValid) {
			return
		}
		this.Consume(particle.Index)
		if (pos.Distance2D(hero.Position) > TRIGGER_RADIUS) {
			return
		}
		this.RecordBlink(pos)
		if (attached instanceof Unit && !this.IsApproachingPos(attached.Index, pos, hero.Position)) {
			return
		}
		this.Trigger("particle", pos, attached instanceof Hero ? attached : undefined)
	}

	private IsBlinkArrival(particle: NetworkedParticle): boolean {
		const path = particle.PathNoEcon
		return path.includes("blink") && !path.includes("_start")
	}

	private ParticlePosition(particle: NetworkedParticle): Nullable<Vector3> {
		const cp = particle.ControlPoints.get(0)
		if (cp !== undefined && cp.IsValid) {
			return cp
		}
		const fallback = particle.ControlPointsFallback.get(0)
		if (fallback !== undefined && fallback.IsValid) {
			return fallback
		}
		return undefined
	}

	private Consume(index: number): void {
		this.consumed.add(index)
		if (this.consumed.size > 512) {
			this.consumed.clear()
			this.consumed.add(index)
		}
	}

	private IsApproachingPos(index: number, landing: Vector3, heroPos: Vector3): boolean {
		const track = this.tracks.get(index)
		if (track === undefined || GameState.RawGameTime - track.prevTime > APPROACH_INFO_TTL) {
			return true
		}
		return track.prevPos.Distance2D(heroPos) - landing.Distance2D(heroPos) >= APPROACH_MIN
	}

	private IsOwnBlink(pos: Vector3, hero: Hero): boolean {
		return this.selfBlinkUntil > GameState.RawGameTime && hero.Position.Distance2D(pos) <= ALLY_NEAR
	}

	private TrackOwnBlink(): void {
		const blink = this.blink
		if (blink === undefined || !blink.IsValid) {
			this.prevOwnCooldown = 0
			return
		}
		const cd = blink.Cooldown
		if (this.prevOwnCooldown <= 0 && cd > 4) {
			this.selfBlinkUntil = GameState.RawGameTime + SELF_BLINK_TIME
		}
		this.prevOwnCooldown = cd
	}

	private HasAllyNear(pos: Vector3, hero: Hero): boolean {
		return EntityManager.GetEntitiesByClass(Hero).some(
			x =>
				x.IsValid &&
				x !== hero &&
				!x.IsEnemy(hero) &&
				x.IsAlive &&
				!x.IsIllusion &&
				x.Position.Distance2D(pos) <= ALLY_NEAR
		)
	}

	private UpdateHooked(hero: Hero): void {
		const now = GameState.RawGameTime
		for (const [index, time] of this.hooked) {
			if (now - time > HOOK_IMMUNE_TIME) {
				this.hooked.delete(index)
			}
		}
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || enemy.IsIllusion || !enemy.IsEnemy(hero)) {
				continue
			}
			const modifier = enemy.GetBuffByName(HOOK_MODIFIER)
			if (modifier !== undefined && modifier.Caster === hero) {
				this.hooked.set(enemy.Index, now)
			}
		}
	}

	private IsHookSuppressed(pos?: Vector3, enemy?: Hero): boolean {
		if (this.hooked.size === 0) {
			return false
		}
		if (enemy !== undefined) {
			return this.hooked.has(enemy.Index)
		}
		if (pos === undefined || !pos.IsValid) {
			return false
		}
		const near = this.NearestEnemyTo(pos)
		return near !== undefined && this.hooked.has(near.Index)
	}

	private Trigger(reason: string, pos?: Vector3, enemy?: Hero): void {
		if (this.IsHookSuppressed(pos, enemy)) {
			return
		}
		const now = GameState.RawGameTime
		this.lastTriggerTime = now
		if (pos !== undefined) {
			pos.CopyTo(this.lastTriggerPos)
		} else {
			this.lastTriggerPos.Invalidate()
		}
		if (enemy !== undefined) {
			this.jumpers.set(enemy.Index, now)
		} else if (this.lastTriggerPos.IsValid) {
			const near = this.NearestEnemyTo(this.lastTriggerPos)
			if (near !== undefined) {
				this.jumpers.set(near.Index, now)
			}
		}
		if (this.sleeper.Sleeping("escape")) {
			return
		}
		this.sleeper.Sleep(RETRIGGER_MS, "escape")
		this.reason = reason
		this.pendingUntil = now + PENDING_TIME
	}

	private NearestEnemyTo(pos: Vector3): Nullable<Hero> {
		const hero = this.Hero
		if (hero === undefined) {
			return undefined
		}
		let best: Nullable<Hero>
		let bestDist = TRIGGER_RADIUS
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion || !enemy.IsEnemy(hero)) {
				continue
			}
			const dist = enemy.Position.Distance2D(pos)
			if (dist < bestDist) {
				bestDist = dist
				best = enemy
			}
		}
		return best
	}

	private PickDestination(hero: Hero, range: number): Vector3 {
		const base = hero.Position
		const enemies = EntityManager.GetEntitiesByClass(Hero).filter(
			x => x.IsValid && x.IsEnemy(hero) && x.IsAlive && x.IsVisible && !x.IsIllusion
		)
		const fountainAngle = this.FountainAngle(hero, enemies)
		const primary = Vector3.FromAngle(fountainAngle).MultiplyScalar(range).AddForThis(base)
		if (enemies.length === 0 || this.MinEnemyDist(primary, enemies) >= SAFE_MIN_DIST) {
			return primary
		}
		let best = primary
		let bestScore = -Infinity
		for (let i = 0; i < CANDIDATES; i++) {
			const offset = (i * 2 * Math.PI) / CANDIDATES
			const dest = Vector3.FromAngle(fountainAngle + offset)
				.MultiplyScalar(range)
				.AddForThis(base)
			const score = this.MinEnemyDist(dest, enemies) + Math.cos(offset) * FOUNTAIN_BONUS
			if (score > bestScore) {
				bestScore = score
				best = dest
			}
		}
		return best
	}

	private FountainAngle(hero: Hero, enemies: Hero[]): number {
		const base = hero.Position
		const fountain = EntityManager.GetEntitiesByClass(Fountain).find(x => x.IsValid && !x.IsEnemy(hero))
		if (fountain !== undefined) {
			const pos = fountain.Position
			return Math.atan2(pos.y - base.y, pos.x - base.x)
		}
		let nearest: Nullable<Hero>
		let nearestDist = Infinity
		for (const enemy of enemies) {
			const dist = enemy.Position.DistanceSqr2D(base)
			if (dist < nearestDist) {
				nearestDist = dist
				nearest = enemy
			}
		}
		if (nearest !== undefined) {
			const pos = nearest.Position
			return Math.atan2(base.y - pos.y, base.x - pos.x)
		}
		return hero.RotationRad + Math.PI
	}

	private MinEnemyDist(dest: Vector3, enemies: Hero[]): number {
		let min = Infinity
		for (const enemy of enemies) {
			const dist = enemy.Position.Distance2D(dest)
			if (dist < min) {
				min = dist
			}
		}
		return min
	}
}
