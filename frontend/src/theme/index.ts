import { createTheme } from "@mantine/core";

const FONT_SANS =
	'"Geist Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/**
 * Mantine 审美基线主题。
 *
 * 刻意回到 Mantine 默认：默认蓝色主色、默认色阶、克制圆角（sm）。
 * 仅保留中文所需的字体栈与 pointer 光标，不再自定义品牌色板。
 */
export const theme = createTheme({
	fontFamily: FONT_SANS,
	defaultRadius: "sm",
	cursorType: "pointer",
});
