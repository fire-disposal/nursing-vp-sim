import { Group, Paper, Progress, Stack, Text } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import Button from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

type AssignmentListItem = components["schemas"]["AssignmentListItem"];

interface AssignmentOverviewProps {
	assignments: AssignmentListItem[];
}

export function AssignmentOverview({ assignments }: AssignmentOverviewProps) {
	const navigate = useNavigate();
	const active = assignments.filter((a) => {
		if (a.is_closed) return false;
		if (a.end_time && new Date(a.end_time) < new Date()) return false;
		return true;
	});

	if (active.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>进行中的作业</CardTitle>
			</CardHeader>
			<CardContent>
				<Stack gap="sm">
					{active.slice(0, 5).map((a) => {
						const pct =
							a.student_count > 0
								? Math.round(
										(a.completed_count / a.student_count) * 100,
									)
								: 0;
						return (
							<Paper key={a.id} withBorder radius="md" p="sm">
								<Stack gap={8}>
									<Group justify="space-between" align="flex-start" wrap="nowrap">
										<div style={{ minWidth: 0 }}>
											<Text size="sm" fw={500} truncate>
												{a.title}
											</Text>
											{a.class_name && (
												<Text size="xs" c="dimmed">
													{a.class_name}
													{a.end_time && (
														<span>
															{" "}
															·{" "}
															{new Date(
																a.end_time,
															).toLocaleDateString("zh-CN", {
																month: "numeric",
																day: "numeric",
															})}{" "}
															到期
														</span>
													)}
												</Text>
											)}
										</div>
										<Button
											variant="outline"
											size="xs"
											onClick={() =>
												navigate(`/admin/assignments/${a.id}`)
											}
										>
											查看详情
										</Button>
									</Group>
									<Group gap={8} wrap="nowrap">
										<Progress value={pct} size="xs" radius="xl" style={{ flex: 1 }} />
										<Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
											{a.completed_count}/{a.student_count}
										</Text>
									</Group>
								</Stack>
							</Paper>
						);
					})}
				</Stack>
			</CardContent>
		</Card>
	);
}
