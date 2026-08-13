import { Group, Text } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { type ComponentType, type ReactNode, useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useUiPrefsStore } from "@/stores/uiPrefsStore";

interface NavGroupProps {
	label: string;
	icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
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
	const open = useUiPrefsStore((s) => s.getNavGroupOpen(storageKey, defaultOpen));
	const setNavGroupOpen = useUiPrefsStore((s) => s.setNavGroupOpen);

	const currentPath = location.pathname;

	useEffect(() => {
		if (!open && currentPath) {
			const container = document.querySelector(`[data-navgroup="${storageKey}"]`);
			if (container?.querySelector('[aria-current="page"]')) {
				setNavGroupOpen(storageKey, true);
			}
		}
	}, [currentPath, open, setNavGroupOpen, storageKey]);

	const toggle = useCallback(() => {
		setNavGroupOpen(storageKey, !open);
	}, [open, setNavGroupOpen, storageKey]);

	if (!children || (Array.isArray(children) && children.filter(Boolean).length === 0)) {
		return null;
	}

	return (
		<div data-navgroup={storageKey}>
			<Group
				gap={8}
				px="sm"
				py={6}
				onClick={toggle}
				className={cn("cursor-pointer")}
				style={{ textTransform: "uppercase" }}
			>
				<Icon size={12} />
				<Text size="xs" fw={600} c="dimmed" opacity={0.6} style={{ flex: 1 }}>
					{label}
				</Text>
				<IconChevronRight
					size={12}
					style={{
						transform: open ? "rotate(90deg)" : undefined,
						transition: "transform 200ms",
					}}
				/>
			</Group>
			{open && <div style={{ marginTop: 2 }}>{children}</div>}
		</div>
	);
}
