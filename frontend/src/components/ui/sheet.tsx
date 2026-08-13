import { Drawer } from "@mantine/core";
import type { ReactNode } from "react";

interface SheetProps {
	open: boolean;
	onClose: () => void;
	side?: "left" | "right" | "bottom";
	size?: "sm" | "md" | "lg";
	children: ReactNode;
}

const SIZE_MAP: Record<string, { bottom: string; side: string }> = {
	sm: { bottom: "40vh", side: "320px" },
	md: { bottom: "65vh", side: "360px" },
	lg: { bottom: "85vh", side: "420px" },
};

export function Sheet({ open, onClose, side = "right", size = "md", children }: SheetProps) {
	const dim = SIZE_MAP[size] ?? SIZE_MAP.md;
	return (
		<Drawer
			opened={open}
			onClose={onClose}
			position={side === "bottom" ? "bottom" : side}
			size={side === "bottom" ? dim.bottom : dim.side}
			withinPortal
		>
			{children}
		</Drawer>
	);
}
