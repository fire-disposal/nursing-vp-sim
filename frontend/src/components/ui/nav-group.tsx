import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/utils/cn";

interface NavGroupProps {
	label: string;
	icon: LucideIcon;
	defaultOpen: boolean;
	storageKey: string;
	children: ReactNode;
}

export function NavGroup({
	label,
	icon: Icon,
	defaultOpen,
	storageKey,
	children,
}: NavGroupProps) {
	const location = useLocation();
	const [open, setOpen] = useState(() => {
		try {
			const stored = localStorage.getItem(`navgroup-${storageKey}`);
			return stored !== null ? stored === "true" : defaultOpen;
		} catch {
			return defaultOpen;
		}
	});

	const currentPath = location.pathname;

	useEffect(() => {
		if (!open && currentPath) {
			const container = document.querySelector(
				`[data-navgroup="${storageKey}"]`,
			);
			if (container?.querySelector("[aria-current=\"page\"]")) {
				setOpen(true);
			}
		}
	}, [currentPath, open, storageKey]);

	const toggle = useCallback(() => {
		setOpen((prev) => {
			const next = !prev;
			try {
				localStorage.setItem(`navgroup-${storageKey}`, String(next));
			} catch {
				// localStorage unavailable
			}
			return next;
		});
	}, [storageKey]);

	if (
		!children ||
		(Array.isArray(children) && children.filter(Boolean).length === 0)
	) {
		return null;
	}

	return (
		<div data-navgroup={storageKey}>
			<button
				type="button"
				onClick={toggle}
				className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider hover:text-muted-foreground transition-colors cursor-pointer"
			>
				<Icon size={12} />
				<span className="flex-1 text-left">{label}</span>
				<ChevronRight
					size={12}
					className={cn(
						"shrink-0 transition-transform duration-200",
						open && "rotate-90",
					)}
				/>
			</button>
			{open && <div className="mt-0.5">{children}</div>}
		</div>
	);
}
