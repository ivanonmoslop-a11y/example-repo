import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_dagon_5")
	private readonly tree = this.base.AddNode("Dagon KillSteal", this.icon)

	public readonly State: Menu.Toggle
	public readonly ToggleKey: Menu.KeyBind
	public readonly DrawRange: Menu.Toggle
	public readonly DrawTarget: Menu.Toggle
	public readonly Notification: Menu.Toggle
	public readonly UseEblade: Menu.Toggle
	public readonly Priority: Menu.Dropdown
	public readonly ShowDebug: Menu.Toggle

	constructor() {
		this.State = this.tree.AddToggle("State", true)
		this.ToggleKey = this.tree.AddKeybind(
			"Toggle Key",
			"None",
			"Горячая клавиша для вкл/выкл KillSteal"
		)
		this.DrawRange = this.tree.AddToggle(
			"Draw Range",
			true,
			"Круг радиуса каста Dagon\n(зелёный — готов, красный — КД/нет маны)"
		)
		this.DrawTarget = this.tree.AddToggle(
			"Target Indicator",
			true,
			"Подсветка цели, которую можно убить"
		)
		this.Notification = this.tree.AddToggle(
			"Kill Notification",
			true,
			"Уведомление после успешного киллстила"
		)
		this.UseEblade = this.tree.AddToggle(
			"Smart E-Blade Combo",
			true,
			"Авто Ethereal Blade + Dagon если одного\nDagon'а не хватает для убийства"
		)
		this.Priority = this.tree.AddDropdown(
			"Priority",
			["Core → Support → Low HP", "Lowest HP First", "Closest First"],
			0,
			"Приоритет целей при нескольких killable"
		)
		this.ShowDebug = this.tree.AddToggle("Show Debug", false)

		this.ToggleKey.OnPressed(() => {
			this.State.value = !this.State.value
		})
	}
}
