import {
	EntityManager,
	Hero,
	Sleeper,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

/**
 * Блок работает не потому, что мы бежим за целью, а потому, что наш хитбокс
 * оказывается там, куда цель уже едет. Отсюда два ключевых куска:
 *
 * 1. Перехват. Точка блока считается итеративно: пока мы бежим к точке, цель
 *    успевает уехать дальше, поэтому точку пересчитываем 4 раза — этого хватает,
 *    чтобы сойтись при любой разнице скоростей.
 * 2. Виляние. Если просто встать на пути, пасфайндер цели один раз обойдёт нас
 *    по дуге и уедет. Поперечные колебания заставляют его перестраиваться
 *    каждый период — именно это и стопит по-настоящему.
 */

/** Итераций решения перехвата. Больше 4 не даёт заметной точности. */
const INTERCEPT_ITERATIONS = 4

/** Как часто переотдаём приказ. Чаще — юнит начинает заикаться на re-path. */
const ORDER_INTERVAL = 120

/** Период смены стороны виляния, мс. */
const WEAVE_PERIOD = 400

/**
 * Запас скорости, ниже которого гнаться за убегающей целью бессмысленно.
 * Цель едет от нас — без этого запаса мы физически не обгоним её.
 */
const SPEED_MARGIN = 25

export class BodyBlocker {
	private readonly orderSleeper = new Sleeper()

	constructor(private readonly menu: MenuManager) {}

	public Reset(): void {
		this.orderSleeper.FullReset()
	}

	public Update(hero: Unit): void {
		if (!this.menu.BodyBlock.value) {
			return
		}
		// Рутованные/застаненные всё равно не сдвинутся — не засоряем очередь приказов.
		if (!hero.IsAlive || hero.IsRooted || hero.IsStunned) {
			return
		}
		const target = this.pickTarget(hero)
		if (target === undefined) {
			return
		}
		if (this.orderSleeper.Sleeping("order")) {
			return
		}
		hero.MoveTo(this.blockPosition(hero, target))
		this.orderSleeper.Sleep(ORDER_INTERVAL, "order")
	}

	/**
	 * Берём не ближайшего врага, а того, кого реально успеваем перехватить:
	 * ближний, но убегающий от нас быстрее — пустая трата времени.
	 */
	private pickTarget(hero: Unit): Nullable<Hero> {
		const maxRange = this.menu.BodyBlockRange.value
		let best: Nullable<Hero>
		let bestTime = Infinity
		const enemies = EntityManager.GetEntitiesByClass(Hero)
		for (const enemy of enemies) {
			if (
				!enemy.IsValid ||
				!enemy.IsEnemy(hero) ||
				!enemy.IsAlive ||
				!enemy.IsVisible ||
				!enemy.IsMoving
			) {
				continue
			}
			if (hero.Distance2D(enemy) > maxRange) {
				continue
			}
			if (!this.canIntercept(hero, enemy)) {
				continue
			}
			const time = this.interceptTime(hero, enemy)
			if (time < bestTime) {
				bestTime = time
				best = enemy
			}
		}
		return best
	}

	/** Цель едет от нас и быстрее нас — обогнать не выйдет, блок невозможен. */
	private canIntercept(hero: Unit, target: Unit): boolean {
		const toHero = hero.Position.Subtract(target.Position).Normalize()
		const movingAway = target.Forward.Dot(toHero) < 0
		if (!movingAway) {
			return true
		}
		return hero.MoveSpeed > target.MoveSpeed + SPEED_MARGIN
	}

	private interceptTime(hero: Unit, target: Unit): number {
		return hero.Distance2D(this.interceptPoint(hero, target)) / hero.MoveSpeed
	}

	/**
	 * Неподвижная точка уравнения «я добегу туда, куда ты доедешь».
	 * Стартуем с текущей позиции цели и уточняем.
	 */
	private interceptPoint(hero: Unit, target: Unit): Vector3 {
		let point = target.Position.Clone()
		for (let i = 0; i < INTERCEPT_ITERATIONS; i++) {
			const travelTime = hero.Distance2D(point) / hero.MoveSpeed
			point = target.VelocityWaypoint(travelTime, target.MoveSpeed)
		}
		return point
	}

	private blockPosition(hero: Unit, target: Unit): Vector3 {
		const hulls = hero.HullRadius + target.HullRadius
		// Уходим на корпус дальше точки встречи: встать ровно на неё — значит
		// столкнуться боком уже после того, как цель проехала мимо.
		const travelTime = this.interceptTime(hero, target)
		const lead = target.VelocityWaypoint(travelTime, target.MoveSpeed)
		const ahead = lead.Add(target.Forward.MultiplyScalar(hulls))
		if (!this.menu.BodyBlockWeave.value) {
			return ahead
		}
		// Знаковая волна, а не синус: пасфайндеру нужен резкий перенос стенки,
		// плавное смещение он обходит одной дугой.
		const side = Math.floor(hrtime() / WEAVE_PERIOD) % 2 === 0 ? 1 : -1
		const perp = target.Forward.Perpendicular(true).Normalize()
		return ahead.Add(perp.MultiplyScalar(hulls * 0.9 * side))
	}
}
