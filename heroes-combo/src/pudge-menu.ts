import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

import { SquareIcons } from "./icons"

export const PUDGE_COMBO = [
	"pudge_meat_hook",
	"pudge_rot",
	"pudge_dismember",
	"pudge_eject",
	"item_blink",
	"item_black_king_bar",
	"item_blade_mail",
	"item_urn_of_shadows",
	"item_spirit_vessel",
	"item_veil_of_discord",
	"item_ethereal_blade",
	"item_dagon_5",
	"item_shivas_guard",
	"item_sheepstick",
	"item_orchid",
	"item_bloodthorn",
	"item_rod_of_atos",
	"item_gungir",
	"item_heavens_halberd"
]

export const PUDGE_LINKEN_BREAKERS = [
	"item_urn_of_shadows",
	"item_spirit_vessel",
	"item_rod_of_atos",
	"item_gungir",
	"item_orchid",
	"item_bloodthorn",
	"item_sheepstick",
	"item_heavens_halberd",
	"item_ethereal_blade",
	"item_dagon_5",
	"item_nullifier",
	"item_force_staff",
	"item_diffusal_blade",
	"item_disperser",
	"item_harpoon",
	"item_medallion_of_courage"
]

export const PUDGE_TREE_CUTTERS = [
	"item_quelling_blade",
	"item_bfury",
	"item_iron_talon",
	"item_tango",
	"item_tango_single"
]

export const enum HookDrawMode {
	Always,
	OnAlt,
	Never
}

export const enum AutoAttackMode {
	Standard,
	HeroesOnly,
	Disabled
}

export class PudgeMenu {
	public readonly State: Menu.Toggle
	public readonly ComboKey: Menu.KeyBind
	public readonly AutoHookKey: Menu.KeyBind
	public readonly ComboOnUlt: Menu.Toggle
	public readonly HitRun: Menu.Toggle
	public readonly ComboAfterHook: Menu.Toggle
	public readonly AntiRubick: Menu.Toggle
	public readonly Combo: Menu.ImageSelector
	public readonly LinkenBreakers: Menu.ImageSelector

	public readonly HookState: Menu.Toggle
	public readonly TreeCutters: Menu.ImageSelector
	public readonly FakeHookKey: Menu.KeyBind
	public readonly AllyHookKey: Menu.KeyBind
	public readonly SpecificSpots: Menu.Toggle
	public readonly DrawMode: Menu.Dropdown
	public readonly AutoAttack: Menu.Dropdown

	public readonly AutoRot: Menu.Toggle
	public readonly AutoDismember: Menu.Toggle
	public readonly EjectKey: Menu.KeyBind

	constructor(parent: Menu.Node) {
		const tree = parent.AddNode("Pudge", ImageData.GetHeroTexture("npc_dota_hero_pudge", true))
		this.State = tree.AddToggle("Pudge", true, "Включить скрипт на Pudge")
		this.ComboKey = tree.AddKeybind(
			"Клавиша комбо",
			"None",
			"Пока зажата — Хук → Гниль → предметы →\nРасчленение → атака по цели у курсора"
		)
		this.AutoHookKey = tree.AddKeybind(
			"Авто-Хук",
			"None",
			"Пока зажата — хук кидается сам,\nтолько когда попадание гарантировано"
		)

		this.ComboOnUlt = tree.AddToggle(
			"Авто-комбо по бинду ульты",
			false,
			"Нажатие Расчленения руками\nзапускает всё комбо"
		)
		this.HitRun = tree.AddToggle(
			"Авто-HitRun после комбо",
			true,
			"Между ударами отходить назад,\nчтобы не стоять под уроном"
		)
		this.ComboAfterHook = tree.AddToggle(
			"Авто-комбо после успешного хука",
			true,
			"Как только хук попал — комбо\nзапускается само, без бинда"
		)
		this.AntiRubick = tree.AddToggle(
			"Анти-кража Хука Рубиком",
			true,
			"Не кидать хук, если рядом Rubick\nс готовой кражей заклинаний"
		)

		this.Combo = SquareIcons(
			tree.AddImageSelector(
				"Предметы и способности",
				PUDGE_COMBO,
				new Map(PUDGE_COMBO.map(name => [name, true])),
				"Клик по иконке — вкл/выкл в комбо.\nПорядок предметов = порядок применения",
				true
			)
		)
		this.LinkenBreakers = SquareIcons(
			tree.AddImageSelector(
				"Приоритет сбития линки в комбо",
				PUDGE_LINKEN_BREAKERS,
				new Map(PUDGE_LINKEN_BREAKERS.map(name => [name, true])),
				"Чем сбивать Linken's Sphere перед\nРасчленением. Порядок — приоритет",
				true
			)
		)

		const hook = tree.AddNode("Настройки хука", ImageData.GetSpellTexture("pudge_meat_hook"))
		this.HookState = hook.AddToggle("Настройки хука", true, "Вспомогательные опции для хука")
		this.TreeCutters = SquareIcons(
			hook.AddImageSelector(
				"Срубка дерева",
				PUDGE_TREE_CUTTERS,
				new Map(PUDGE_TREE_CUTTERS.map(name => [name, true])),
				"Чем срубить дерево, стоящее\nна линии хука",
				true
			)
		)
		this.FakeHookKey = hook.AddKeybind("Fake Hook", "None", "Анимация хука без броска —\nкаст отменяется до вылета")
		this.AllyHookKey = hook.AddKeybind(
			"Ally Hook",
			"None",
			"Хук по союзнику у курсора:\nвытянуть его из-под фокуса"
		)
		this.SpecificSpots = hook.AddToggle(
			"Специфичные места для хука",
			true,
			"Не кидать хук, если линию перекрывает\nдерево. Юниты на линии учитываются всегда"
		)
		this.DrawMode = hook.AddDropdown(
			"Режим отображения",
			["Всегда", "При зажатом Alt", "Никогда"],
			1,
			"Когда рисовать дальность хука\nи точку упреждения"
		)
		this.AutoAttack = hook.AddDropdown(
			"Автоатака (выберите как в доте)",
			["Стандартно", "Только по героям", "Выключена"],
			0,
			"Чем добивать между кастами в комбо"
		)

		const extra = tree.AddNode("Доп. функции", ImageData.GetSpellTexture("pudge_rot"))
		this.AutoRot = extra.AddToggle(
			"Авто-Гниль",
			false,
			"Сама включает Гниль, когда враг\nв радиусе, и выключает, когда вышел",
			0,
			ImageData.GetSpellTexture("pudge_rot")
		)
		this.AutoDismember = extra.AddToggle(
			"Авто-Расчленение",
			false,
			"Сразу ест цель, которую притянул хук,\nбез зажатого комбо",
			0,
			ImageData.GetSpellTexture("pudge_dismember")
		)
		this.EjectKey = extra.AddKeybind(
			"Забросить под вышку",
			"None",
			"Выплюнуть захваченную цель\nв сторону своей ближайшей вышки (шард)"
		)
	}
}
