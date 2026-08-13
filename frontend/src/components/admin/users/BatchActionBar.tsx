import { IconX } from "@tabler/icons-react";
import { Button, Group, Paper, Text } from "@mantine/core";

interface BatchActionBarProps {
	selectedCount: number;
	onClearSelection: () => void;
	onBulkAssignClass: () => void;
	onBulkResetPassword: () => void;
}

export default function BatchActionBar({
	selectedCount,
	onClearSelection,
	onBulkAssignClass,
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
				paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
			}}
		>
			<Group gap="sm" wrap="nowrap">
				<Text size="sm" fw={500} style={{ whiteSpace: "nowrap" }}>
					已选 {selectedCount} 人
				</Text>
				<Button size="sm" onClick={onBulkAssignClass}>
					批量分配班级
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
				>
					<IconX size={16} />
				</Button>
			</Group>
		</Paper>
	);
}
