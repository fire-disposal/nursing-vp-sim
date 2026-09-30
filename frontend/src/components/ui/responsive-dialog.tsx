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
 * Adaptive dialog: centered modal on desktop, bottom sheet on mobile.
 *
 * 断点归属：「弹窗 ↔ 底部抽屉」的分界由 `useIsMobile()` 决定，即 WIDTH.phoneShell (768px)。
 * 文件里的 `md` / `sm` 是 Mantine 的 em 断点（`sm` = 48em = 768px、`md` = 62em = 992px）与
 * 尺寸刻度（Sheet/Text 的 size、间距），引不到 px 常量，对应关系靠这条注释钉住。
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
