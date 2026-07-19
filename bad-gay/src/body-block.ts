import {
	EntityManager,
	GameState,
	Hero,
	InputManager,
	LocalPlayer,
	Sleeper,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

/**
 * Блок держится на том, что наш хитбокс оказывается там, куда цель уже едет.
 * Точка перехвата решается итеративно: пока мы бежим, цель уезжает дальше,
 * поэтому оценку уточняем несколько раз до сходимости.
 */
const INTERCEPT_ITERATIONS = 4

/**
 * Базовый интервал переотдачи приказа. Меньше нельзя: каждый новый приказ
 * сбрасывает набранное ускорение, и юнит начинает топтаться на месте вместо
 * движения. Это не «хуманизатор», а ограничение движка — спам каждый кадр
 * даёт меньше контроля, а не больше.
 */
const ORDER_INTERVAL = 100

/**
 * Смена курса цели больше этого угла (градусы — AngleBetweenVectors отдаёт
 * именно их) означает, что прошлая точка перехвата протухла. Ждать таймера
 * в этом случае нельзя: именно из-за этого блок отпускал жертву на развороте.
 */
const COURSE_CHANGE_EPSILON = 15

/** Период смены стороны зигзага, мс. */
const WEAVE_PERIOD = 300

/** Дистанция в хитбоксах, ближе которой начинаем вилять поперёк курса. */
const WEAVE_ENGAGE_HULLS = 2.2

/** Радиус поиска цели вокруг курсора при захвате. */
const CURSOR_ACQUIRE_RANGE = 400

/** Сквозь эти состояния коллизии нет — блокировать бесполезно. */
const NO_COLLISION_MODIFIERS = [
	"modifier_item_phase_boots_active",
	"modifier_phased",
	"modifier_item_voidwalker_phased",
	"modifier_spectre_spectral_dagger_path_phased",
	"modifier_windrun_zephyr",
	"modifier_slark_dark_pact_pulses"
]

export class BodyBlocker {
	private readonly orderSleeper = new Sleeper()
	private locked: Nullable<Unit>
	private lastCourse: Nullable<Vector3>

	constructor(private readonly menu: MenuManager) {}

	public Reset(): void {
		this.orderSleeper.FullReset()
		this.locked = undefined
		this.lastCourse = undefined
	}

	public Update(): void {
		if (!this.menu.BodyBlock.value || !this.menu.BodyBlockKey.isPressed) {
			// Бинд отпущен — мгновенно отдаём управление игроку.
			this.Reset()
			return
		}
		const blockers = this.blockers()
		if (blockers.length === 0) {
			return
		}
		const target = this.resolveTarget(blockers[0])
		if (target === undefined) {
			return
		}
		if (!this.shouldReissue(target)) {
			return
		}
		for (const blocker of blockers) {
			blocker.MoveTo(this.blockPosition(blocker, target))
		}
		this.lastCourse = target.Forward.Clone()
		this.orderSleeper.Sleep(ORDER_INTERVAL, "order")
	}

	/**
	 * Блокируем всем, что выделено — герой, призванные существа, что угодно
	 * подконтрольное. Если выделения нет, откатываемся на своего героя.
	 */
	private blockers(): Unit[] {
		const selected = InputManager.SelectedEntities.filter(
			unit => unit.IsValid && unit.IsAlive && unit.IsControllable
		)
		if (selected.length !== 0) {
			return selected
		}
		const hero = LocalPlayer?.Hero
		return hero !== undefined && hero.IsAlive ? [hero] : []
	}

	/** Захват держится до отпускания бинда, даже если курсор увели. */
	private resolveTarget(blocker: Unit): Nullable<Unit> {
		if (this.locked !== undefined && this.isBlockable(this.locked, blocker)) {
			return this.locked
		}
		this.locked = this.acquireFromCursor(blocker)
		this.lastCourse = undefined
		return this.locked
	}

	private acquireFromCursor(blocker: Unit): Nullable<Unit> {
		const cursor = InputManager.CursorOnWorld
		let best: Nullable<Hero>
		let bestDistance = CURSOR_ACQUIRE_RANGE
		for (const hero of EntityManager.GetEntitiesByClass(Hero)) {
			if (!this.isBlockable(hero, blocker)) {
				continue
			}
			const distance = hero.Distance2D(cursor)
			if (distance < bestDistance) {
				bestDistance = distance
				best = hero
			}
		}
		return best
	}

	private isBlockable(unit: Unit, blocker: Unit): boolean {
		return (
			unit.IsValid &&
			unit.IsAlive &&
			unit.IsVisible &&
			!unit.IsIllusion &&
			unit !== blocker &&
			unit.IsEnemy(blocker) &&
			!this.hasNoCollision(unit)
		)
	}

	/** Сквозь фазовую цель не блокируют — только бегут рядом. */
	private hasNoCollision(unit: Unit): boolean {
		return NO_COLLISION_MODIFIERS.some(name => unit.HasBuffByName(name))
	}

	/**
	 * Переотдаём приказ по таймеру ИЛИ немедленно, если цель сменила курс.
	 * Чистый таймер — причина, по которой блок отпускал жертву на развороте:
	 * мы до 100 мс продолжали бежать в устаревшую точку перехвата.
	 */
	private shouldReissue(target: Unit): boolean {
		if (this.lastCourse === undefined) {
			return true
		}
		if (this.lastCourse.AngleBetweenVectors(target.Forward) > COURSE_CHANGE_EPSILON) {
			this.orderSleeper.ResetKey("order")
			return true
		}
		return !this.orderSleeper.Sleeping("order")
	}

	/**
	 * Время до контакта считаем с поправкой на RTT: то, что мы видим, уже
	 * устарело на половину пинга, и приказ доедет до сервера ещё за половину.
	 */
	private latencySeconds(): number {
		return GameState.Ping / 1000
	}

	private interceptPoint(blocker: Unit, target: Unit): Vector3 {
		let point = target.Position.Clone()
		const latency = this.latencySeconds()
		for (let i = 0; i < INTERCEPT_ITERATIONS; i++) {
			const travelTime = blocker.Distance2D(point) / blocker.MoveSpeed + latency
			point = target.VelocityWaypoint(travelTime, target.MoveSpeed)
		}
		return point
	}

	private blockPosition(blocker: Unit, target: Unit): Vector3 {
		const hulls = blocker.HullRadius + target.HullRadius
		const intercept = this.interceptPoint(blocker, target)
		// Встать ровно на точку встречи мало: столкнёмся боком уже после того,
		// как цель прошла. Уходим на корпус дальше по её курсу.
		const ahead = intercept.Add(target.Forward.MultiplyScalar(hulls))
		if (!this.menu.BodyBlockWeave.value) {
			return ahead
		}
		// Виляем только вплотную — издалека зигзаг только удлиняет наш путь.
		if (blocker.Distance2D(target) > hulls * WEAVE_ENGAGE_HULLS) {
			return ahead
		}
		// Знаковая волна, а не синус: плавное смещение пасфайндер цели обходит
		// одной дугой, ему нужен резкий перенос стенки.
		const side = Math.floor(hrtime() / WEAVE_PERIOD) % 2 === 0 ? 1 : -1
		const amplitude = this.menu.BodyBlockJitter.value
		const perp = target.Forward.Perpendicular(true).Normalize()
		return ahead.Add(perp.MultiplyScalar(amplitude * side))
	}
}
