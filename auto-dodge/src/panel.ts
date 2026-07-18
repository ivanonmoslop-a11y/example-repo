import {
	Color,
	GUIInfo,
	InputEventSDK,
	InputManager,
	Rectangle,
	RendererSDK,
	TextFlags,
	Vector2,
	VMouseKeys
} from "github.com/octarine-public/wrapper/index"

import { CounterSlot } from "./counters"

const HEADER_H = 24
const ICON = 34
const PAD = 4
const BUTTON_H = 24

const BG_COLOR = new Color(14, 16, 22, 230)
const HEADER_COLOR = new Color(28, 32, 44, 255)
const TITLE_COLOR = new Color(0, 255, 255)
const ON_BORDER = new Color(80, 220, 120)
const OFF_BORDER = new Color(110, 110, 110)
const MISSING_TINT = new Color(255, 255, 255, 90)
const BUTTON_ON = new Color(34, 120, 62, 255)
const BUTTON_OFF = new Color(70, 70, 70, 255)

interface PanelLayout {
	panel: Rectangle
	header: Rectangle
	slots: [CounterSlot, Rectangle][]
	cancelButton: Rectangle
	blinkButton: Rectangle
}

export class DodgePanel {
	public visible = true
	public cancelAnimation = true
	public blinkAway = true

	private readonly pos = new Vector2().Invalidate()
	private readonly dragOffset = new Vector2()
	private dragging = false

	constructor(private readonly slots: CounterSlot[]) {
		InputEventSDK.on("MouseKeyDown", key => this.MouseKeyDown(key))
		InputEventSDK.on("MouseKeyUp", key => this.MouseKeyUp(key))
	}

	public Toggle(): void {
		this.visible = !this.visible
	}

	public Reset(): void {
		this.dragging = false
	}

	public Draw(): void {
		if (!this.visible) {
			return
		}
		const layout = this.GetLayout()
		if (layout === undefined) {
			return
		}
		if (this.dragging) {
			const size = layout.panel.pos2.Subtract(layout.panel.pos1)
			InputManager.CursorOnScreen.Subtract(this.dragOffset)
				.Min(RendererSDK.WindowSize.Subtract(size))
				.Max(0)
				.CopyTo(this.pos)
			RendererSDK.InvalidateDraw2D()
		}
		this.DrawBackground(layout)
		this.DrawSlots(layout)
		this.DrawButton(layout.cancelButton, "Отмена анимации", this.cancelAnimation)
		this.DrawButton(layout.blinkButton, "Блинк от врага", this.blinkAway)
	}

	private DrawBackground(layout: PanelLayout): void {
		const size = layout.panel.pos2.Subtract(layout.panel.pos1)
		RendererSDK.FilledRect(layout.panel.pos1, size, BG_COLOR)
		const headerSize = layout.header.pos2.Subtract(layout.header.pos1)
		RendererSDK.FilledRect(layout.header.pos1, headerSize, HEADER_COLOR)
		RendererSDK.TextByFlags("DODGE", layout.header, TITLE_COLOR, 1.6)
		RendererSDK.OutlinedRect(layout.panel.pos1, size, 1, HEADER_COLOR)
	}

	private DrawSlots(layout: PanelLayout): void {
		for (const [slot, rect] of layout.slots) {
			const size = rect.pos2.Subtract(rect.pos1)
			const tint = slot.IsFound ? Color.White : MISSING_TINT
			RendererSDK.Image(slot.Texture, rect.pos1, -1, size, tint, 0, undefined, !slot.enabled)
			RendererSDK.OutlinedRect(rect.pos1, size, 2, slot.enabled ? ON_BORDER : OFF_BORDER)
		}
	}

	private DrawButton(rect: Rectangle, label: string, state: boolean): void {
		const size = rect.pos2.Subtract(rect.pos1)
		RendererSDK.FilledRect(rect.pos1, size, state ? BUTTON_ON : BUTTON_OFF)
		RendererSDK.TextByFlags(`${label}: ${state ? "ВКЛ" : "ВЫКЛ"}`, rect, Color.White, 1.8, TextFlags.Center)
	}

	private GetLayout(): Nullable<PanelLayout> {
		const shown = this.slots.filter(x => x.IsShown)
		if (shown.length === 0) {
			return undefined
		}
		const pad = GUIInfo.ScaleHeight(PAD)
		const icon = GUIInfo.ScaleHeight(ICON)
		const headerH = GUIInfo.ScaleHeight(HEADER_H)
		const buttonH = GUIInfo.ScaleHeight(BUTTON_H)
		const width = pad + shown.length * (icon + pad)
		const height = headerH + pad + icon + pad + 2 * (buttonH + pad)
		const size = new Vector2(width, height)
		this.EnsurePos(size)
		const p = this.pos
		const panel = new Rectangle(p.Clone(), p.Add(size))
		const header = new Rectangle(p.Clone(), p.Add(new Vector2(width, headerH)))
		const slots: [CounterSlot, Rectangle][] = []
		let slotX = p.x + pad
		const y = p.y + headerH + pad
		for (const slot of shown) {
			slots.push([slot, new Rectangle(new Vector2(slotX, y), new Vector2(slotX + icon, y + icon))])
			slotX += icon + pad
		}
		const by = y + icon + pad
		const cancelButton = new Rectangle(new Vector2(p.x + pad, by), new Vector2(p.x + width - pad, by + buttonH))
		const by2 = by + buttonH + pad
		const blinkButton = new Rectangle(new Vector2(p.x + pad, by2), new Vector2(p.x + width - pad, by2 + buttonH))
		return { panel, header, slots, cancelButton, blinkButton }
	}

	private EnsurePos(size: Vector2): void {
		const window = RendererSDK.WindowSize
		if (!this.pos.IsValid) {
			new Vector2(window.x * 0.4, window.y * 0.78).CopyTo(this.pos)
		}
		this.pos.Min(window.Subtract(size)).Max(0).CopyTo(this.pos)
	}

	private MouseKeyDown(key: VMouseKeys): boolean {
		if (!this.visible || key !== VMouseKeys.MK_LBUTTON) {
			return true
		}
		const layout = this.GetLayout()
		if (layout === undefined) {
			return true
		}
		const cursor = InputManager.CursorOnScreen
		if (!layout.panel.Contains(cursor)) {
			return true
		}
		if (layout.header.Contains(cursor)) {
			this.dragging = true
			cursor.Subtract(this.pos).CopyTo(this.dragOffset)
			return false
		}
		for (const [slot, rect] of layout.slots) {
			if (rect.Contains(cursor)) {
				slot.enabled = !slot.enabled
				return false
			}
		}
		if (layout.cancelButton.Contains(cursor)) {
			this.cancelAnimation = !this.cancelAnimation
			return false
		}
		if (layout.blinkButton.Contains(cursor)) {
			this.blinkAway = !this.blinkAway
			return false
		}
		return false
	}

	private MouseKeyUp(key: VMouseKeys): boolean {
		if (key !== VMouseKeys.MK_LBUTTON || !this.dragging) {
			return true
		}
		this.dragging = false
		return false
	}
}
