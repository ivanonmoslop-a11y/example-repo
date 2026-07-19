import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_dust")
	private readonly tree = this.base.AddNode("Bad Gay", this.icon)

	public readonly State: Menu.Toggle
	public readonly DustAbuse: Menu.Toggle
	public readonly PingSpam: Menu.Toggle
	public readonly MinimapPaint: Menu.Toggle
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
		this.MinimapPaint = this.tree.AddToggle(
			"Minimap Paint",
			false,
			"Моментально закрасить всю карту рисованием"
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
