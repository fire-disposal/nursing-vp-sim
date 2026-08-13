import { Box, Modal, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/useLayoutMode";

import { Sheet } from "@/components/ui/sheet";

interface ResponsiveDialogProps {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	children: ReactNode;
	maxWidth?: number;
}

/**
 * Adaptive dialog: centered modal on desktop (>=768px), bottom sheet on mobile.
 */
export function ResponsiveDialog({
	open,
	onClose,
	title,
	children,
	maxWidth,
}: ResponsiveDialogProps) {
	const isMobile = useIsMobile();

	if (isMobile) {
		return (
			<Sheet open={open} onClose={onClose} side="bottom" size="md">
				<Box p="lg" pt={40}>
					{title != null && (
						<Text fw={500} mb="md" size="md">
							{title}
						</Text>
					)}
					{children}
				</Box>
			</Sheet>
		);
	}

	return (
		<Modal opened={open} onClose={onClose} title={title} size={maxWidth} centered withinPortal>
			{children}
		</Modal>
	);
}
