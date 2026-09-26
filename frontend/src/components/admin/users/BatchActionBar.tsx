import { IconX } from "@tabler/icons-react";
import { Button, Group, Paper, Text } from "@mantine/core";

interface BatchActionBarProps {
	selectedCount: number;
	onClearSelection: () => void;
	onAddToClass: () => void;
	onRemoveFromClass: () => void;
	onBulkResetPassword: () => void;
}

export default function BatchActionBar({
	selectedCount,
	onClearSelection,
	onAddToClass,
	onRemoveFromClass,
	onBulkResetPassword,
}: BatchActionBarProps) {
	if (selectedCount === 0) return null;

	return (
		<Paper
			withBorder
			radius="md"
			shadow="md"
			p="md"
			style={{
				position: "fixed",
				bottom: "1rem",
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 40,
				maxWidth: "calc(100vw - 2rem)",
				paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
			}}
		>
			<Group gap="sm" wrap="wrap">
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
	);
}
