import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback } from "react";

export function ModeToggle() {
	const { setTheme, resolvedTheme } = useTheme();

	const toggle = useCallback(() => {
		setTheme(resolvedTheme === "dark" ? "light" : "dark");
	}, [setTheme, resolvedTheme]);

	return (
		<button
			type="button"
			onClick={toggle}
			className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-accent transition-colors"
			aria-label="切换主题"
		>
			<Sun size={14} className="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
			<Moon size={14} className="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
		</button>
	);
}
