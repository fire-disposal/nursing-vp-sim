import { Badge, Box, Group, Stack, Text } from "@mantine/core";

export interface ActivityEvent {
	id: string | number;
	time: string;
	studentName: string;
	action: string;
	meta?: string;
	metaColor?: "green" | "amber" | "red";
}

const metaColorMap: Record<string, string> = {
	green: "green",
	amber: "yellow",
	red: "red",
};

interface ActivityTimelineProps {
	events: ActivityEvent[];
	className?: string;
}

export function ActivityTimeline({
	events,
	className,
}: ActivityTimelineProps) {
	if (events.length === 0) {
		return (
			<Text size="sm" c="dimmed" ta="center" py={32} className={className}>
				暂无最近动态
			</Text>
		);
	}

	return (
		<Stack gap={0} className={className}>
			{events.map((event) => (
				<Group key={event.id} align="flex-start" gap={12} py={10} wrap="nowrap">
					<Text
						size="xs"
						c="dimmed"
						w={40}
						ta="right"
						pt={2}
						style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
					>
						{event.time}
					</Text>
					<Box
						bg="gray.4"
						style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0 }}
					/>
					<Box style={{ flex: 1, minWidth: 0 }}>
						<Group gap={8} align="center" wrap="wrap">
							<Text size="sm">
								<Text component="span" fw={500} inherit>
									{event.studentName}
								</Text>
								<Text component="span" c="dimmed" inherit>
									{" "}
									{event.action}
								</Text>
							</Text>
							{event.meta && (
								<Badge
									variant="light"
									size="xs"
									color={event.metaColor ? metaColorMap[event.metaColor] : "gray"}
								>
									{event.meta}
								</Badge>
							)}
						</Group>
					</Box>
				</Group>
			))}
		</Stack>
	);
}
