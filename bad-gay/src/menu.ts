import { Color, ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_dust")
	private readonly tree = this.base.AddNode("Bad Gay", this.icon)

	public readonly State: Menu.Toggle
	public readonly DustAbuse: Menu.Toggle
	public readonly PingSpam: Menu.Toggle
	public readonly MinimapPaint: Menu.Toggle
	public readonly MinimapPaintStep: Menu.Slider
	public readonly MinimapPaintSpeed: Menu.Slider
	public readonly MinimapPaintKey: Menu.KeyBind
	public readonly MinimapPaintAuto: Menu.Toggle
	public readonly MinimapPaintColor: Menu.ColorPicker
	public readonly MinimapPaintWidth: Menu.Slider
	public readonly MinimapPaintClear: Menu.KeyBind
	public readonly RightClickSpam: Menu.Toggle
	public readonly BodyBlock: Menu.Toggle
	public readonly BodyBlockRange: Menu.Slider
	public readonly BodyBlockWeave: Menu.Toggle

	constructor() {
		this.State = this.tree.AddToggle("State", true, "Главный переключатель скрипта")
		this.DustAbuse = this.tree.AddToggle(
			"Dust Abuse",
			false,
			"Спам покупка + продажа Dust of Appearance"
		)
		this.PingSpam = this.tree.AddToggle(
			"Ping Spam",
			false,
			"Спам пингов по позициям тиммейтов (все сразу)"
		)

		const paintNode = this.tree.AddNode("Minimap Paint")
		this.MinimapPaint = paintNode.AddToggle(
			"State",
			false,
			"Рисование на миникарте через CTRL+курсор"
		)
		this.MinimapPaintStep = paintNode.AddSlider(
			"Шаг сетки (×100 юнитов)",
			5,
			2,
			20,
			0,
			"Расстояние между точками. Меньше = плотнее покрытие"
		)
		this.MinimapPaintSpeed = paintNode.AddSlider(
			"Задержка (мс)",
			50,
			0,
			500,
			0,
			"0 = без задержки (каждый тик). Больше = медленнее рисует"
		)
		this.MinimapPaintKey = paintNode.AddKeybind(
			"Кнопка рисования",
			"None",
			"Держать и водить курсором по миникарте"
		)
		this.MinimapPaintAuto = paintNode.AddToggle(
			"Авто-закраска",
			false,
			"Само штрихует всю карту змейкой вместо ручного рисования"
		)
		this.MinimapPaintColor = paintNode.AddColorPicker(
			"Цвет",
			new Color(255, 60, 60)
		)
		this.MinimapPaintWidth = paintNode.AddSlider("Толщина линии", 2, 1, 10)
		this.MinimapPaintClear = paintNode.AddKeybind(
			"Очистить",
			"None",
			"Стереть всё нарисованное"
		)

		this.RightClickSpam = this.tree.AddToggle(
			"RMB Spam",
			false,
			"Автоповтор ПКМ — быстрое перекликивание любого игрока"
		)
		const blockNode = this.tree.AddNode("Body Block")
		this.BodyBlock = blockNode.AddToggle(
			"State",
			false,
			"Перехват врагов — встать на пути движения, а не бежать следом"
		)
		this.BodyBlockRange = blockNode.AddSlider(
			"Радиус поиска",
			1200,
			400,
			3000,
			0,
			"Максимальная дистанция до цели, которую пытаемся блокировать"
		)
		this.BodyBlockWeave = blockNode.AddToggle(
			"Виляние",
			true,
			"Поперечные колебания поперёк пути цели — мешает обойти по дуге"
		)
	}
}
