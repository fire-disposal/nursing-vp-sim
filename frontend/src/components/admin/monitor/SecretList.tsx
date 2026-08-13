import { Badge, Button, Group, Paper, Text } from "@mantine/core";
import type { ApiSecretResponse, FallbackStateResponse } from "@/api/admin/api-management-types";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
	costColorClass,
	recoveryText,
	statusText,
} from "@/utils/llm-status";

interface SecretListProps {
	secrets: ApiSecretResponse[];
	envFallback: FallbackStateResponse | undefined;
	onEdit: (secret: ApiSecretResponse) => void;
	onDelete: (secret: ApiSecretResponse) => void;
}

const STATUS_DOT: Record<string, string> = {
	active: "#22c55e",
	degraded: "#f59e0b",
	disabled: "#f87171",
};

export default function SecretList({
	secrets,
	envFallback,
	onEdit,
	onDelete,
}: SecretListProps) {
	return (
		<Paper withBorder radius="md" p={0} style={{ overflow: "hidden" }}>
			<Table>
				<TableBody>
					{envFallback?.available !== undefined && (
						<TableRow>
							<TableCell style={{ whiteSpace: "nowrap" }}>
								<Group gap="xs" wrap="nowrap">
									<span
										style={{
											width: 8,
											height: 8,
											borderRadius: "50%",
											flexShrink: 0,
											background: "#22c55e",
										}}
									/>
									<Text fw={600}>环境变量</Text>
									<Badge variant="light" color="green" size="xs">
										当前
									</Badge>
								</Group>
							</TableCell>
							<TableCell style={{ whiteSpace: "nowrap" }}>
								<Text component="span" c="dimmed" ff="monospace" size="xs">
									sk-...{envFallback?.key_suffix || "****"}
								</Text>
							</TableCell>
							<TableCell style={{ whiteSpace: "nowrap" }}>
								<Text component="span" size="xs" c="green">
									{envFallback?.available ? "可用" : "不可用"}
								</Text>
							</TableCell>
							<TableCell style={{ whiteSpace: "nowrap" }}>
								<Text component="span" size="xs" c="dimmed" opacity={0.6}>
									{(envFallback?.call_count ?? 0) > 0
										? `${envFallback?.call_count}次 · ¥${envFallback?.total_cost}`
										: ""}
								</Text>
							</TableCell>
							<TableCell />
						</TableRow>
					)}
					{[...secrets]
						.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
						.map((s) => {
							const cost = Number(s.monthly_cost_used ?? 0);
							const limit = s.monthly_cost_limit ?? null;
							const isDisabled = s.status === "disabled";
							const _recovery =
								s.status === "degraded"
									? recoveryText(s.degraded_until, s.degraded_reason)
									: "";
							return (
								<TableRow key={s.id} style={{ opacity: isDisabled ? 0.5 : undefined }}>
									<TableCell style={{ whiteSpace: "nowrap" }}>
										<Group gap="xs" wrap="nowrap">
											<span
												style={{
													width: 8,
													height: 8,
													borderRadius: "50%",
													flexShrink: 0,
													background: STATUS_DOT[s.status] || "#9ca3af",
												}}
											/>
											<Text fw={600}>{s.label}</Text>
											{isDisabled && (
												<Text size="xs" c="dimmed" opacity={0.5}>
													已停用
												</Text>
											)}
										</Group>
									</TableCell>
									<TableCell style={{ whiteSpace: "nowrap" }}>
										<Badge variant="light" color="gray" size="xs">
											P{s.priority ?? 0}
										</Badge>
									</TableCell>
									<TableCell style={{ whiteSpace: "nowrap" }}>
										<Text component="span" c="dimmed" ff="monospace" size="xs">
											sk-...{s.key_suffix}
										</Text>
									</TableCell>
									<TableCell style={{ whiteSpace: "nowrap" }}>
										<Text component="span" size="xs" c="dimmed">
											{isDisabled ? "已停用" : statusText(s.status)}
										</Text>
									</TableCell>
									<TableCell style={{ whiteSpace: "nowrap" }}>
										<Text component="span" size="xs" className={costColorClass(cost, limit)}>
											¥{cost.toFixed(2)} /{" "}
											{limit ? `¥${Number(limit).toFixed(0)}` : "不限"}
										</Text>
									</TableCell>
									<TableCell style={{ whiteSpace: "nowrap" }}>
										<Group gap="xs" wrap="nowrap">
											<Button variant="transparent" size="xs" onClick={() => onEdit(s)}>
												编辑
											</Button>
											<Button variant="transparent" size="xs" color="red" onClick={() => onDelete(s)}>
												删除
											</Button>
										</Group>
									</TableCell>
								</TableRow>
							);
						})}
				</TableBody>
			</Table>
		</Paper>
	);
}
