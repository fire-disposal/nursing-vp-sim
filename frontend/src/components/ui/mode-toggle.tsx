import { Moon, Monitor, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback } from "react";

const ORDER = ["light", "dark", "system"] as const;

function NextIcon(theme: string | undefined) {
	if (theme === "dark") return Sun;
	if (theme === "system" || !theme) return Moon;
	return Monitor;
}

function Label(theme: string | undefined) {
	if (theme === "dark") return "亮色模式";
	if (theme === "system" || !theme) return "深色模式";
	return "跟随系统";
}

export function ModeToggle() {
	const { setTheme, theme } = useTheme();

	const toggle = useCallback(() => {
		const idx = ORDER.indexOf((theme as (typeof ORDER)[number]) ?? "system");
		setTheme(ORDER[(idx + 1) % ORDER.length]);
	}, [setTheme, theme]);

	const Icon = NextIcon(theme);

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
