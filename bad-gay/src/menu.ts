import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_dust")
	private readonly tree = this.base.AddNode("Bad Gay", this.icon)

	public readonly State: Menu.Toggle
	public readonly DustAbuse: Menu.Toggle
	public readonly DustKey: Menu.KeyBind
	public readonly PingSpam: Menu.Toggle
	public readonly PingKey: Menu.KeyBind

	constructor() {
		this.State = this.tree.AddToggle("State", true, "Главный переключатель скрипта")
		this.DustAbuse = this.tree.AddToggle(
			"Dust Abuse",
			false,
			"Спам покупка + продажа Dust of Appearance"
		)
		this.DustKey = this.tree.AddKeybind(
			"Dust Abuse Key",
			"None",
			"Зажми — даст спамит, отпусти — стоп"
		)
		this.PingSpam = this.tree.AddToggle(
			"Ping Spam",
			false,
			"Спам пингов по позициям тиммейтов"
		)
		this.PingKey = this.tree.AddKeybind(
			"Ping Spam Key",
			"None",
			"Зажми — спамит пинги на тиммейтов"
		)
	}
}
