import { ActionIcon, useMantineColorScheme } from "@mantine/core";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";

const ORDER = ["light", "dark", "auto"] as const;
type Mode = (typeof ORDER)[number];

const LABELS: Record<Mode, string> = {
	light: "亮色模式",
	dark: "深色模式",
	auto: "跟随系统",
};

/**
 * 主题切换（亮 → 深 → 跟随系统）。
 *
 * 状态直接来自 Mantine 的 `colorScheme`，**不要**再维护本地影子状态：
 * 2026-09-26 前它只在挂载时读一次 `localStorage`，于是 provider 默认亮色时按钮却自称
 * "跟随系统"，且首次点击是 `auto → light` 的空操作（画面无变化），见审计 UI-DS-2。
 * 现在图标与 aria-label 跟随实际 scheme，首点即生效。
 */
export function ModeToggle() {
	const { colorScheme, setColorScheme } = useMantineColorScheme();
	const mode: Mode = ORDER.includes(colorScheme as Mode) ? (colorScheme as Mode) : "auto";
	const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
	const Icon = mode === "dark" ? IconMoon : mode === "light" ? IconSun : IconDeviceDesktop;

	return (
		<ActionIcon
			variant="default"
			size={36}
			onClick={() => setColorScheme(next)}
			aria-label={`当前${LABELS[mode]}，点击切换到${LABELS[next]}`}
			title={`当前：${LABELS[mode]} → ${LABELS[next]}`}
		>
			<Icon size={16} />
		</ActionIcon>
	);
}
