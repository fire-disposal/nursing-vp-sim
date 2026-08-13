import { Center, Group, Text } from "@mantine/core";
import { IconWifiOff } from "@tabler/icons-react";

export function NetworkBanner() {
	return (
		<Center
			bg="yellow.5"
			px="md"
			py={6}
			style={{ flexShrink: 0 }}
		>
			<Group gap={8}>
				<IconWifiOff size={14} />
				<Text size="sm" fw={500} c="white">
					网络已断开，部分功能不可用
				</Text>
			</Group>
		</Center>
	);
}
