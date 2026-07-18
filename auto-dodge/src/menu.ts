import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_cyclone")
	private readonly tree = this.base.AddNode("Auto Dodge", this.icon)

	public readonly State: Menu.Toggle
	public readonly PanelKey: Menu.KeyBind
	public readonly ShowDebug: Menu.Toggle

	constructor() {
		this.State = this.tree.AddToggle("State", true)
		this.PanelKey = this.tree.AddKeybind(
			"Panel Key",
			"None",
			"Показать/скрыть панель доджа.\nКлик по иконке — вкл/выкл контры.\nКнопки: отмена анимации при додже\nи ответный блинк от врага (к фонтану\nили туда, где враги дальше всего)"
		)
		this.ShowDebug = this.tree.AddToggle("Show Debug", false)
	}
}
