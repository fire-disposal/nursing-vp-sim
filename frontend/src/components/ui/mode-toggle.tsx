import { ActionIcon, useMantineColorScheme } from "@mantine/core";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useState } from "react";

const ORDER = ["light", "dark", "auto"] as const;
type Mode = (typeof ORDER)[number];

const LABELS: Record<Mode, string> = {
	light: "亮色模式",
	dark: "深色模式",
	auto: "跟随系统",
};

function readInitial(): Mode {
	try {
		const v = localStorage.getItem("mantine-color-scheme-value");
		if (v === "light" || v === "dark" || v === "auto") return v;
	} catch {
		/* noop */
	}
	return "auto";
}

export function ModeToggle() {
	const { setColorScheme } = useMantineColorScheme();
	const [mode, setMode] = useState<Mode>(readInitial);

	const cycle = () => {
		const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
		setMode(next);
		setColorScheme(next);
	};

	const Icon = mode === "dark" ? IconMoon : mode === "light" ? IconSun : IconDeviceDesktop;
	return (
		<ActionIcon
			variant="default"
			size={36}
			onClick={cycle}
			aria-label={LABELS[mode]}
			title={LABELS[mode]}
		>
			<Icon size={16} />
		</ActionIcon>
	);
}
