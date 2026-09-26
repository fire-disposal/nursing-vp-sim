import { IconX } from "@tabler/icons-react";
import { Affix, Box, Button, Group, Paper, Text } from "@mantine/core";

interface BatchActionBarProps {
	selectedCount: number;
	onClearSelection: () => void;
	onAddToClass: () => void;
	onRemoveFromClass: () => void;
	onBulkResetPassword: () => void;
}

/**
 * 批量操作条。
 *
 * 用 Mantine `Affix`（`withinPortal` 默认 true → 挂到 body）而不是裸 `position: fixed`：
 * 页面内容包裹层（`ShellTransition`）一旦带上 `transform`/`will-change` 之类属性就会成为
 * fixed 后代的包含块，条子会跑到内容末尾的视口外（2026-09-26 线上实测）。
 * Portal + Affix 让它与视口绑定，内部滚动容器与页面动画都不再影响它。
 * 外层容器 pointerEvents:none，避免遮住下方内容的点击；安全区由 bottom 的 calc 承担。
 */
export default function BatchActionBar({
	selectedCount,
	onClearSelection,
	onAddToClass,
	onRemoveFromClass,
	onBulkResetPassword,
}: BatchActionBarProps) {
	if (selectedCount === 0) return null;

	return (
		<Affix
			position={{ bottom: 16, left: 0, right: 0 }}
			zIndex={40}
			style={{ pointerEvents: "none" }}
		>
			<Box px="md" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
				<Paper
					withBorder
					radius="md"
					shadow="md"
					p="md"
					mx="auto"
					w="fit-content"
					maw="calc(100vw - 2rem)"
					style={{ pointerEvents: "auto" }}
				>
					<Group gap="sm" wrap="wrap" justify="center">
						<Text size="sm" fw={500} style={{ whiteSpace: "nowrap" }}>
							已选 {selectedCount} 人
						</Text>
						<Button size="sm" onClick={onAddToClass}>
							添加到班级
						</Button>
						<Button size="sm" variant="light" color="orange" onClick={onRemoveFromClass}>
							从班级移除
						</Button>
						<Button size="sm" variant="light" color="gray" onClick={onBulkResetPassword}>
							批量重置密码
						</Button>
						<Button
							size="sm"
							w={36}
							h={36}
							p={0}
							variant="subtle"
							color="gray"
							onClick={onClearSelection}
							title="取消选择"
							aria-label="取消选择"
						>
							<IconX size={16} />
						</Button>
					</Group>
				</Paper>
			</Box>
		</Affix>
	);
}
