import {
	Color,
	GUIInfo,
	InputManager,
	MinimapSDK,
	RendererSDK,
	Sleeper,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

/**
 * Штрихи храним в мировых координатах, а не в экранных: миникарту можно
 * ресайзить (dota_hud_extra_large_minimap), HUD — флипать, разрешение — менять.
 * Мировая точка переживёт всё это, экранная уедет.
 */
type Stroke = Vector2[]

/** Дальше этого лимита рисовать бессмысленно — начинает жрать кадры. */
const MAX_POINTS = 4000

/** Минимальный сдвиг курсора (в экранных px) между сэмплами штриха. */
const SAMPLE_DISTANCE = 2

export class MinimapPainter {
	private readonly strokes: Stroke[] = []
	private readonly autoSleeper = new Sleeper()
	private current: Nullable<Stroke>
	private lastScreenSample: Nullable<Vector2>
	private autoPath: Vector2[] = []
	private autoIndex = 0
	private pointCount = 0

	constructor(private readonly menu: MenuManager) {
		this.menu.MinimapPaintClear.OnRelease(() => this.Clear())
	}

	public Clear(): void {
		this.strokes.splice(0, this.strokes.length)
		this.current = undefined
		this.lastScreenSample = undefined
		this.autoPath = []
		this.autoIndex = 0
		this.pointCount = 0
		this.autoSleeper.FullReset()
	}

	/** Вызывать каждый тик — набирает точки. */
	public Update(): void {
		if (!this.menu.MinimapPaint.value) {
			this.endStroke()
			return
		}
		if (this.menu.MinimapPaintAuto.value) {
			this.updateAuto()
			return
		}
		this.updateFreehand()
	}

	/** Вызывать из Draw2D — рисует то, что набрано. */
	public Draw(): void {
		if (!this.menu.MinimapPaint.value) {
			return
		}
		const bounds = GUIInfo.Minimap.MinimapRenderBounds
		if (bounds.IsZero()) {
			return
		}
		const color = this.menu.MinimapPaintColor.SelectedColor
		const width = GUIInfo.ScaleWidth(this.menu.MinimapPaintWidth.value)
		for (const stroke of this.strokes) {
			this.drawStroke(stroke, color, width)
		}
		if (this.current !== undefined) {
			this.drawStroke(this.current, color, width)
		}
	}

	private drawStroke(stroke: Stroke, color: Color, width: number): void {
		if (stroke.length < 2) {
			return
		}
		const scissor = GUIInfo.Minimap.MinimapRenderBounds
		let prev = MinimapSDK.WorldToMinimap(Vector3.FromVector2(stroke[0]))
		for (let i = 1; i < stroke.length; i++) {
			const next = MinimapSDK.WorldToMinimap(Vector3.FromVector2(stroke[i]))
			RendererSDK.Line(prev, next, color, width, 0, scissor)
			prev = next
		}
	}

	private updateFreehand(): void {
		if (!this.menu.MinimapPaintKey.isPressed) {
			this.endStroke()
			return
		}
		const cursor = InputManager.CursorOnScreen
		if (!GUIInfo.Minimap.MinimapRenderBounds.Contains(cursor)) {
			// Курсор ушёл с миникарты — рвём штрих, иначе получим
			// прямую через полкарты при возврате.
			this.endStroke()
			return
		}
		if (
			this.lastScreenSample !== undefined &&
			this.lastScreenSample.Distance(cursor) < SAMPLE_DISTANCE
		) {
			return
		}
		this.lastScreenSample = cursor.Clone()
		this.pushPoint(Vector2.FromVector3(MinimapSDK.MinimapToWorld(cursor)))
	}

	private updateAuto(): void {
		const delay = this.menu.MinimapPaintSpeed.value
		if (delay > 0 && this.autoSleeper.Sleeping("auto")) {
			return
		}
		if (this.autoIndex >= this.autoPath.length) {
			this.buildAutoPath()
			this.autoIndex = 0
			this.endStroke()
			if (this.autoPath.length === 0) {
				return
			}
		}
		this.pushPoint(this.autoPath[this.autoIndex])
		this.autoIndex++
		if (delay > 0) {
			this.autoSleeper.Sleep(delay, "auto")
		}
	}

	private pushPoint(worldPos: Vector2): void {
		if (this.pointCount >= MAX_POINTS) {
			return
		}
		if (this.current === undefined) {
			this.current = []
			this.strokes.push(this.current)
		}
		this.current.push(worldPos)
		this.pointCount++
	}

	private endStroke(): void {
		if (this.current !== undefined && this.current.length < 2) {
			this.strokes.splice(this.strokes.indexOf(this.current), 1)
		}
		this.current = undefined
		this.lastScreenSample = undefined
	}

	/** Змейка по всей карте с лёгким дрожанием — чтобы не выглядело как сетка. */
	private buildAutoPath(): void {
		this.autoPath = []
		const bounds = MinimapSDK.MinimapBounds
		if (bounds.IsZero()) {
			return
		}
		const step = this.menu.MinimapPaintStep.value * 100
		const wobble = step * 0.4
		let leftToRight = true
		for (let y = bounds.Top; y <= bounds.Bottom; y += step) {
			const rowY = y + (Math.random() - 0.5) * wobble
			const from = leftToRight ? bounds.Left : bounds.Right
			const to = leftToRight ? bounds.Right : bounds.Left
			const dx = leftToRight ? step : -step
			for (let x = from; leftToRight ? x <= to : x >= to; x += dx) {
				this.autoPath.push(
					new Vector2(
						x + (Math.random() - 0.5) * wobble,
						rowY + (Math.random() - 0.5) * wobble * 0.3
					)
				)
			}
			leftToRight = !leftToRight
		}
	}
}
