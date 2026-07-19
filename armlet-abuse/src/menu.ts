import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_armlet")
	private readonly tree = this.base.AddNode("Armlet Abuse", this.icon)

	public readonly State: Menu.Toggle
	public readonly ToggleKey: Menu.KeyBind
	public readonly ThresholdMode: Menu.Dropdown
	public readonly HPThreshold: Menu.Slider
	public readonly ShowDebug: Menu.Toggle

	public static readonly MODE_PING = 0
	public static readonly MODE_MANUAL = 1

	constructor() {
		this.State = this.tree.AddToggle("State", true)
		this.ToggleKey = this.tree.AddKeybind(
			"Toggle Key",
			"None",
			"Включает/выключает абуз прямо в бою.\nПри выключении армлет возвращается\nв надетое состояние"
		)
		this.ThresholdMode = this.tree.AddDropdown(
			"Threshold Mode",
			["Auto (by ping)", "Manual HP"],
			MenuManager.MODE_PING,
			"Auto scales the HP threshold with your ping.\nManual uses the slider below"
		)
		this.HPThreshold = this.tree.AddSlider(
			"HP Threshold",
			300,
			50,
			550,
			0,
			"Burst as soon as HP is at or below this value.\nCapped at the armlet bonus — it cannot refill higher"
		)
		this.ShowDebug = this.tree.AddToggle("Show Debug", false)

		this.ApplyThresholdMode()
		this.ThresholdMode.OnValue(() => this.ApplyThresholdMode())
	}

	private ApplyThresholdMode(): void {
		this.HPThreshold.IsHidden = this.ThresholdMode.SelectedID !== MenuManager.MODE_MANUAL
		this.tree.Update()
	}
}
