import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback } from "react";

const ORDER = ["light", "dark", "system"] as const;

function CurrentIcon(theme: string | undefined) {
	if (theme === "dark") return Moon;
	if (theme === "light") return Sun;
	return Monitor;
}

function Label(theme: string | undefined) {
	if (theme === "dark") return "深色模式";
	if (theme === "light") return "亮色模式";
	return "跟随系统";
}

export function ModeToggle() {
	const { setTheme, theme } = useTheme();

	const toggle = useCallback(() => {
		const idx = ORDER.indexOf((theme as (typeof ORDER)[number]) ?? "system");
		setTheme(ORDER[(idx + 1) % ORDER.length]);
	}, [setTheme, theme]);

	const Icon = CurrentIcon(theme);

	return (
		<button
			type="button"
			onClick={toggle}
			className="relative flex size-8 items-center justify-center rounded-lg border border-border hover:bg-accent transition-colors"
			aria-label={Label(theme)}
			title={Label(theme)}
		>
			<Icon size={14} />
		</button>
	);
}
