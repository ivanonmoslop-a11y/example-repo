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
import { DisableSlot } from "./disable"
import { GetSlotTexture, MoveDodgeSlot } from "./moveDodge"

const HEADER_H = 24
const ICON = 34
const PAD = 4
const BUTTON_H = 24
const SECTION_H = 20
const MOVE_ICON = 28
const MOVE_COLS_MIN = 10

const BG_COLOR = new Color(14, 16, 22, 230)
const HEADER_COLOR = new Color(28, 32, 44, 255)
const TITLE_COLOR = new Color(0, 255, 255)
const SECTION_COLOR = new Color(180, 60, 60)
const ON_BORDER = new Color(80, 220, 120)
const OFF_BORDER = new Color(110, 110, 110)
const MISSING_TINT = new Color(255, 255, 255, 90)
const BUTTON_ON = new Color(34, 120, 62, 255)
const BUTTON_OFF = new Color(70, 70, 70, 255)
const DRAG_TINT = new Color(255, 255, 255, 190)
const DRAG_THRESHOLD = 6

interface PanelLayout {
	panel: Rectangle
	header: Rectangle
	slots: [CounterSlot, Rectangle][]
	cancelButton: Rectangle
	blinkButton: Rectangle
	moveHeader: Rectangle
	moveToggleButton: Rectangle
	blockButton: Rectangle
	moveSlots: [MoveDodgeSlot, Rectangle][]
	disableHeader: Rectangle
	disableButton: Rectangle
	disableSlots: [DisableSlot, Rectangle][]
}

interface IconDrag {
	counter?: CounterSlot
	disable?: DisableSlot
	texture: string
	moved: boolean
}

export class DodgePanel {
	public visible = true
	public cancelAnimation = true
	public blinkAway = true
	public moveDodgeEnabled = true
	public blockControl = false
	public autoDisable = false

	private readonly pos = new Vector2().Invalidate()
	private readonly dragOffset = new Vector2()
	private readonly iconDragStart = new Vector2()
	private dragging = false
	private iconDrag: Nullable<IconDrag>

	constructor(
		private readonly slots: CounterSlot[],
		private readonly moveSlots: MoveDodgeSlot[],
		private readonly disableSlots: DisableSlot[]
	) {
		InputEventSDK.on("MouseKeyDown", key => this.MouseKeyDown(key))
		InputEventSDK.on("MouseKeyUp", key => this.MouseKeyUp(key))
	}

	public Toggle(): void {
		this.visible = !this.visible
	}

	public Reset(): void {
		this.dragging = false
		this.iconDrag = undefined
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
		this.DrawCounterSlots(layout)
		this.DrawButton(layout.cancelButton, "Отмена анимации", this.cancelAnimation)
		this.DrawButton(layout.blinkButton, "Блинк от врага", this.blinkAway)
		this.DrawSectionHeader(layout.moveHeader, "ДВИЖЕНИЕ")
		this.DrawButton(layout.moveToggleButton, "Доджить движением", this.moveDodgeEnabled)
		this.DrawButton(layout.blockButton, "Блокировать управление", this.blockControl)
		this.DrawMoveSlots(layout)
		this.DrawSectionHeader(layout.disableHeader, "АВТОДИЗЕЙБЛ")
		this.DrawButton(layout.disableButton, "Автодизейбл", this.autoDisable)
		this.DrawDisableSlots(layout)
		this.DrawDraggedIcon(layout)
	}

	private DrawDraggedIcon(layout: PanelLayout): void {
		const drag = this.iconDrag
		if (drag === undefined) {
			return
		}
		const cursor = InputManager.CursorOnScreen
		if (cursor.Distance(this.iconDragStart) > DRAG_THRESHOLD) {
			drag.moved = true
		}
		RendererSDK.InvalidateDraw2D()
		if (!drag.moved) {
			return
		}
		const iconRect = layout.slots[0]?.[1] ?? layout.disableSlots[0]?.[1]
		if (iconRect === undefined) {
			return
		}
		const size = iconRect.pos2.Subtract(iconRect.pos1)
		const at = cursor.Subtract(size.DivideScalar(2))
		RendererSDK.Image(drag.texture, at, -1, size, DRAG_TINT)
		RendererSDK.OutlinedRect(at, size, 2, TITLE_COLOR)
	}

	private DrawDisableSlots(layout: PanelLayout): void {
		for (const [slot, rect] of layout.disableSlots) {
			const size = rect.pos2.Subtract(rect.pos1)
			const tint = slot.IsFound ? Color.White : MISSING_TINT
			RendererSDK.Image(slot.Texture, rect.pos1, -1, size, tint, 0, undefined, !slot.enabled)
			RendererSDK.OutlinedRect(rect.pos1, size, 2, slot.enabled ? ON_BORDER : OFF_BORDER)
		}
	}

	private DrawBackground(layout: PanelLayout): void {
		const size = layout.panel.pos2.Subtract(layout.panel.pos1)
		RendererSDK.FilledRect(layout.panel.pos1, size, BG_COLOR)
		const headerSize = layout.header.pos2.Subtract(layout.header.pos1)
		RendererSDK.FilledRect(layout.header.pos1, headerSize, HEADER_COLOR)
		RendererSDK.TextByFlags("DODGE", layout.header, TITLE_COLOR, 1.6)
		RendererSDK.OutlinedRect(layout.panel.pos1, size, 1, HEADER_COLOR)
	}

	private DrawSectionHeader(rect: Rectangle, text: string): void {
		const size = rect.pos2.Subtract(rect.pos1)
		RendererSDK.FilledRect(rect.pos1, size, HEADER_COLOR)
		RendererSDK.TextByFlags(text, rect, SECTION_COLOR, 1.4)
	}

	private DrawCounterSlots(layout: PanelLayout): void {
		for (const [slot, rect] of layout.slots) {
			const size = rect.pos2.Subtract(rect.pos1)
			const tint = slot.IsFound ? Color.White : MISSING_TINT
			RendererSDK.Image(slot.Texture, rect.pos1, -1, size, tint, 0, undefined, !slot.enabled)
			RendererSDK.OutlinedRect(rect.pos1, size, 2, slot.enabled ? ON_BORDER : OFF_BORDER)
		}
	}

	private DrawMoveSlots(layout: PanelLayout): void {
		for (const [slot, rect] of layout.moveSlots) {
			const size = rect.pos2.Subtract(rect.pos1)
			const tex = GetSlotTexture(slot)
			RendererSDK.Image(tex, rect.pos1, -1, size, Color.White, 0, undefined, !slot.enabled)
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
		const disableShown = this.disableSlots

		const pad = GUIInfo.ScaleHeight(PAD)
		const icon = GUIInfo.ScaleHeight(ICON)
		const headerH = GUIInfo.ScaleHeight(HEADER_H)
		const buttonH = GUIInfo.ScaleHeight(BUTTON_H)
		const sectionH = GUIInfo.ScaleHeight(SECTION_H)
		const moveIcon = GUIInfo.ScaleHeight(MOVE_ICON)

		const counterW = pad + shown.length * (icon + pad)
		const minMoveW = pad + MOVE_COLS_MIN * (moveIcon + pad)
		const disableW = pad + disableShown.length * (icon + pad)
		const width = Math.max(counterW, minMoveW, disableW)
		const moveCols = Math.max(1, Math.floor((width - pad) / (moveIcon + pad)))
		const moveRows = Math.ceil(this.moveSlots.length / moveCols)
		const counterRowH = shown.length > 0 ? icon + pad : 0
		const disableRowH = disableShown.length > 0 ? icon + pad : 0

		const height =
			headerH +
			pad +
			counterRowH +
			2 * (buttonH + pad) +
			sectionH +
			pad +
			2 * (buttonH + pad) +
			moveRows * (moveIcon + pad) +
			sectionH +
			pad +
			buttonH +
			pad +
			disableRowH

		const size = new Vector2(width, height)
		this.EnsurePos(size)
		const p = this.pos
		const panel = new Rectangle(p.Clone(), p.Add(size))
		const header = new Rectangle(p.Clone(), p.Add(new Vector2(width, headerH)))

		let y = p.y + headerH + pad
		const slots: [CounterSlot, Rectangle][] = []
		let slotX = p.x + pad
		for (const slot of shown) {
			slots.push([slot, new Rectangle(new Vector2(slotX, y), new Vector2(slotX + icon, y + icon))])
			slotX += icon + pad
		}
		y += counterRowH

		const cancelButton = new Rectangle(new Vector2(p.x + pad, y), new Vector2(p.x + width - pad, y + buttonH))
		y += buttonH + pad
		const blinkButton = new Rectangle(new Vector2(p.x + pad, y), new Vector2(p.x + width - pad, y + buttonH))
		y += buttonH + pad

		const moveHeader = new Rectangle(new Vector2(p.x, y), new Vector2(p.x + width, y + sectionH))
		y += sectionH + pad

		const moveToggleButton = new Rectangle(new Vector2(p.x + pad, y), new Vector2(p.x + width - pad, y + buttonH))
		y += buttonH + pad
		const blockButton = new Rectangle(new Vector2(p.x + pad, y), new Vector2(p.x + width - pad, y + buttonH))
		y += buttonH + pad

		const moveSlotRects: [MoveDodgeSlot, Rectangle][] = []
		for (let i = 0; i < this.moveSlots.length; i++) {
			const col = i % moveCols
			const row = Math.floor(i / moveCols)
			const sx = p.x + pad + col * (moveIcon + pad)
			const sy = y + row * (moveIcon + pad)
			moveSlotRects.push([
				this.moveSlots[i],
				new Rectangle(new Vector2(sx, sy), new Vector2(sx + moveIcon, sy + moveIcon))
			])
		}

		y += moveRows * (moveIcon + pad)

		const disableHeader = new Rectangle(new Vector2(p.x, y), new Vector2(p.x + width, y + sectionH))
		y += sectionH + pad
		const disableButton = new Rectangle(new Vector2(p.x + pad, y), new Vector2(p.x + width - pad, y + buttonH))
		y += buttonH + pad

		const disableSlotRects: [DisableSlot, Rectangle][] = []
		let disableX = p.x + pad
		for (const slot of disableShown) {
			disableSlotRects.push([
				slot,
				new Rectangle(new Vector2(disableX, y), new Vector2(disableX + icon, y + icon))
			])
			disableX += icon + pad
		}

		return {
			panel,
			header,
			slots,
			cancelButton,
			blinkButton,
			moveHeader,
			moveToggleButton,
			blockButton,
			moveSlots: moveSlotRects,
			disableHeader,
			disableButton,
			disableSlots: disableSlotRects
		}
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
				this.iconDrag = { counter: slot, texture: slot.Texture, moved: false }
				cursor.CopyTo(this.iconDragStart)
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
		if (layout.moveToggleButton.Contains(cursor)) {
			this.moveDodgeEnabled = !this.moveDodgeEnabled
			return false
		}
		if (layout.blockButton.Contains(cursor)) {
			this.blockControl = !this.blockControl
			return false
		}
		for (const [slot, rect] of layout.moveSlots) {
			if (rect.Contains(cursor)) {
				slot.enabled = !slot.enabled
				return false
			}
		}
		if (layout.disableButton.Contains(cursor)) {
			this.autoDisable = !this.autoDisable
			return false
		}
		for (const [slot, rect] of layout.disableSlots) {
			if (rect.Contains(cursor)) {
				this.iconDrag = { disable: slot, texture: slot.Texture, moved: false }
				cursor.CopyTo(this.iconDragStart)
				return false
			}
		}
		return false
	}

	private MouseKeyUp(key: VMouseKeys): boolean {
		if (key !== VMouseKeys.MK_LBUTTON) {
			return true
		}
		const drag = this.iconDrag
		if (drag !== undefined) {
			this.iconDrag = undefined
			this.FinishIconDrag(drag)
			return false
		}
		if (!this.dragging) {
			return true
		}
		this.dragging = false
		return false
	}

	private FinishIconDrag(drag: IconDrag): void {
		const layout = this.GetLayout()
		if (layout === undefined) {
			return
		}
		if (!drag.moved) {
			const slot = drag.counter ?? drag.disable
			if (slot !== undefined) {
				slot.enabled = !slot.enabled
			}
			return
		}
		const cursor = InputManager.CursorOnScreen
		if (drag.counter !== undefined) {
			const target = layout.slots.find(([, rect]) => rect.Contains(cursor))
			if (target !== undefined) {
				this.Reorder(this.slots, drag.counter, target[0])
			}
			return
		}
		if (drag.disable !== undefined) {
			const target = layout.disableSlots.find(([, rect]) => rect.Contains(cursor))
			if (target !== undefined) {
				this.Reorder(this.disableSlots, drag.disable, target[0])
			}
		}
	}

	private Reorder<T>(list: T[], moved: T, before: T): void {
		const from = list.indexOf(moved)
		const to = list.indexOf(before)
		if (from < 0 || to < 0 || from === to) {
			return
		}
		list.splice(from, 1)
		list.splice(to, 0, moved)
	}
}
