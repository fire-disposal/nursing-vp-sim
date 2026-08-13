import { Box, Group, Paper, SimpleGrid, Text, ThemeIcon } from "@mantine/core";
import { IconChartBar, IconClock, IconFileText, IconUser } from "@tabler/icons-react";
import Badge from "@/components/ui/badge";
import type { ScoreData } from "@/types/score";

interface RecordStatsBarRecord {
	user_display_name?: string;
	case_name?: string;
	training_type?: string;
}

interface Props {
	record: RecordStatsBarRecord;
	duration: number | null;
	hasScore: boolean;
	recordScore: ScoreData | null;
	scoreMax: number;
}

export default function RecordStatsBar({
	record,
	duration,
	hasScore,
	recordScore,
	scoreMax,
}: Props) {
	return (
		<SimpleGrid cols={{ base: 2, lg: 4 }} spacing={{ base: "sm", sm: "md" }}>
			<Paper withBorder radius="lg" p={{ base: "sm", sm: "md" }}>
				<Group gap="sm" wrap="nowrap">
					<ThemeIcon size={40} radius="md" variant="filled" color="blue">
						<IconUser size={18} />
					</ThemeIcon>
					<Box style={{ minWidth: 0 }}>
						<Text size="md" fw={700} truncate>
							{record.user_display_name || "-"}
						</Text>
						<Text size="xs" c="dimmed">
							学生
						</Text>
					</Box>
				</Group>
			</Paper>

			<Paper withBorder radius="lg" p={{ base: "sm", sm: "md" }}>
				<Group gap="sm" wrap="nowrap">
					<ThemeIcon size={40} radius="md" variant="light" color="blue">
						<IconFileText size={18} />
					</ThemeIcon>
					<Box style={{ minWidth: 0, flex: 1 }}>
						<Text size="md" fw={700} truncate>
							{record.case_name || "-"}
						</Text>
						<Group gap={6} mt={2}>
							<Text size="xs" c="dimmed">
								病例
							</Text>
							<Badge variant="secondary" size="xs">
								问诊
							</Badge>
						</Group>
					</Box>
				</Group>
			</Paper>

			<Paper withBorder radius="lg" p={{ base: "sm", sm: "md" }}>
				<Group gap="sm" wrap="nowrap">
					<ThemeIcon size={40} radius="md" variant="filled" color="yellow">
						<IconClock size={18} />
					</ThemeIcon>
					<Box style={{ minWidth: 0 }}>
						<Text size="xl" fw={700}>
							{duration != null ? `${duration}分钟` : "-"}
						</Text>
						<Text size="xs" c="dimmed">
							训练时长
						</Text>
					</Box>
				</Group>
			</Paper>

			<Paper withBorder radius="lg" p={{ base: "sm", sm: "md" }}>
				<Group gap="sm" wrap="nowrap">
					<ThemeIcon size={40} radius="md" variant="filled" color="green">
						<IconChartBar size={18} />
					</ThemeIcon>
					<Box style={{ minWidth: 0 }}>
						<Text size="xl" fw={700}>
							{recordScore?.total_score ?? "-"}
						</Text>
						<Text size="xs" c="dimmed">
							{hasScore ? `得分 / ${scoreMax}` : "得分"}
						</Text>
					</Box>
				</Group>
			</Paper>
		</SimpleGrid>
	);
}
