export interface PouncePoint {
	x: number
	y: number
	z: number
}

export interface PouncePrediction {
	point: PouncePoint
	reachable: boolean
	travelTime: number
}

const MIN_SPEED = 1
const INTERCEPT_PASSES = 6

export function predictPouncePoint(
	origin: PouncePoint,
	target: PouncePoint,
	velocity: PouncePoint | undefined,
	castDelay: number,
	leapSpeed: number,
	leapDistance: number
): PouncePrediction {
	const movement = velocity ?? { x: 0, y: 0, z: 0 }
	let travelTime = distance2D(origin, target) / Math.max(leapSpeed, MIN_SPEED)
	let point = target

	for (let pass = 0; pass < INTERCEPT_PASSES; pass++) {
		const totalTime = Math.max(castDelay, 0) + travelTime
		point = {
			x: target.x + movement.x * totalTime,
			y: target.y + movement.y * totalTime,
			z: target.z + movement.z * totalTime
		}
		travelTime = distance2D(origin, point) / Math.max(leapSpeed, MIN_SPEED)
	}

	return {
		point,
		reachable: distance2D(origin, point) <= leapDistance,
		travelTime
	}
}

function distance2D(first: PouncePoint, second: PouncePoint): number {
	return Math.hypot(second.x - first.x, second.y - first.y)
}
