import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_dust")
	private readonly tree = this.base.AddNode("Bad Gay", this.icon)

	public readonly State: Menu.Toggle
	public readonly DustAbuse: Menu.Toggle
	public readonly PingSpam: Menu.Toggle
	public readonly MinimapPaint: Menu.Toggle
	public readonly MinimapPaintStep: Menu.Slider
	public readonly MinimapPaintBatch: Menu.Slider
	public readonly MinimapPaintKey: Menu.KeyBind
	public readonly RightClickSpam: Menu.Toggle
	public readonly BodyBlock: Menu.Toggle

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
			"Заливка миникарты пингами — видят все союзники"
		)
		this.MinimapPaintStep = paintNode.AddSlider(
			"Шаг сетки (×100 юнитов)",
			5,
			1,
			20,
			0,
			"Меньше = плотнее, больше нагрузка на сервер"
		)
		this.MinimapPaintBatch = paintNode.AddSlider(
			"Строк за тик",
			3,
			1,
			10,
			0,
			"Сколько горизонтальных линий пингов за один тик"
		)
		this.MinimapPaintKey = paintNode.AddKeybind(
			"Кнопка вкл/выкл",
			"None",
			"Мгновенный старт/стоп заливки карты"
		)

		this.RightClickSpam = this.tree.AddToggle(
			"RMB Spam",
			false,
			"Автоповтор ПКМ — быстрое перекликивание любого игрока"
		)
		this.BodyBlock = this.tree.AddToggle(
			"Body Block",
			false,
			"Блокировка героев — идти в хитбокс ближайшего союзника"
		)
	}
}
