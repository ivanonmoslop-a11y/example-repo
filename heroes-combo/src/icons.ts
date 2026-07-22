import { Menu } from "github.com/octarine-public/wrapper/index"

const ICONS_PER_ROW = 5

interface IImageSelectorLayout {
	imageSize: { x: number; y: number }
	Size: { x: number }
	values: string[]
}

export function SquareIcons(selector: Menu.ImageSelector): Menu.ImageSelector {
	const update = selector.Update.bind(selector)
	const layout = selector as unknown as IImageSelectorLayout
	selector.Update = () => {
		if (!update()) {
			return false
		}
		const extra = layout.imageSize.x - layout.imageSize.y
		if (extra > 0) {
			layout.imageSize.x = layout.imageSize.y
			layout.Size.x -= extra * Math.min(layout.values.length, ICONS_PER_ROW)
		}
		return true
	}
	return selector
}
