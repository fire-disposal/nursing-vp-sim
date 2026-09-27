import {
	Alert,
	Badge,
	Button,
	Code,
	Group,
	Loader,
	Pagination,
	Paper,
	Select,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	getAdminScenarioSession,
	listAdminScenarioPacks,
	listAdminScenarioSessions,
} from "@/api/scenario";
import { formatShortDateTime } from "@/utils/date";
import ScenarioReportView from "../ScenarioReportView";
import ScenarioSidePanel from "../ScenarioSidePanel";
import ScenarioStage, { ScenarioLine } from "../ScenarioStage";
import { sessionStatusLabel, summaryText } from "../sessions";

const STATUS_OPTIONS = [
	{ value: "active", label: "进行中" },
	{ value: "completed", label: "已结算" },
];

const PAGE_SIZE = 50;

/**
 * 会话：列表（可按包 / 状态筛选）+ 单次回放（学生视图 + 报告 + **诊断问题** + 事件流）。
 *
 * 这里是**唯一**能看到原始诊断串的地方（`dm_parse:*`、`leaked_fact_term:*`…）：
 * 学生侧只会看到一句"本回合由系统保底生成"。回放视图不可交互（不给在场者按钮）。
 */
export default function AdminSessionsPanel({
	focusSessionId = null,
}: {
	/** 从别处（生成物面板）带过来的会话：进来就直接展开它的回放。 */
	focusSessionId?: number | null;
} = {}) {
	const [packKey, setPackKey] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState<number | null>(null);

	const packsQuery = useQuery({
		queryKey: queryKeys.scenario.admin.packs(),
		queryFn: listAdminScenarioPacks,
	});
	const offset = (page - 1) * PAGE_SIZE;
	const query = { pack_key: packKey, status, limit: PAGE_SIZE, offset };
	const listQuery = useQuery({
		queryKey: queryKeys.scenario.admin.sessions(query),
		queryFn: () => listAdminScenarioSessions(query),
	});
	const detailQuery = useQuery({
		queryKey: queryKeys.scenario.admin.session(selectedId),
		queryFn: () => getAdminScenarioSession(selectedId ?? 0),
		enabled: selectedId !== null,
	});

	// 换筛选 → 回到第一页（否则会停在越界页上）；外部带过来的会话直接展开
	useEffect(() => {
		setPage(1);
	}, [packKey, status]);
	useEffect(() => {
		if (focusSessionId !== null) setSelectedId(focusSessionId);
	}, [focusSessionId]);

	const packs = packsQuery.data ?? [];
	const rows = listQuery.data?.items ?? [];
	const detail = detailQuery.data ?? null;
	const total = listQuery.data?.total ?? 0;
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<Stack gap="md">
			<Group align="flex-end" gap="sm" wrap="wrap">
				<Select
					label="情境包"
					w={260}
					placeholder="全部"
					clearable
					value={packKey}
					onChange={(value) => {
						setPackKey(value);
						setSelectedId(null);
					}}
					data={packs.map((pack) => ({
						value: pack.key,
						label: `${pack.title}（${pack.key}）`,
					}))}
					aria-label="按情境包筛选"
				/>
				<Select
					label="状态"
					w={140}
					placeholder="全部"
					clearable
					value={status}
					onChange={(value) => {
						setStatus(value);
						setSelectedId(null);
					}}
					data={STATUS_OPTIONS}
					aria-label="按状态筛选"
				/>
				<Text size="xs" c="dimmed" pb={6}>
					共 {total} 次
					{total > 0 && ` · 第 ${page}/${pages} 页`}
				</Text>
			</Group>

			{listQuery.isLoading ? (
				<Group justify="center" py="xl">
					<Loader size="sm" />
				</Group>
			) : listQuery.isError ? (
				<Text size="sm" c="red">
					会话列表读取失败：请确认有「数据查看」权限，或稍后重试。
				</Text>
			) : rows.length === 0 ? (
				<Text size="sm" c="dimmed">
					没有符合条件的会话。
				</Text>
			) : (
				<Table.ScrollContainer minWidth={900}>
					<Table highlightOnHover verticalSpacing="xs">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>#</Table.Th>
								<Table.Th>学生</Table.Th>
								<Table.Th>情境包</Table.Th>
								<Table.Th>状态</Table.Th>
								<Table.Th>回合</Table.Th>
								<Table.Th>结局</Table.Th>
								<Table.Th>锚点</Table.Th>
								<Table.Th>更新</Table.Th>
								<Table.Th>操作</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{rows.map((row) => (
								<Table.Tr key={row.id}>
									<Table.Td>{row.id}</Table.Td>
									<Table.Td>{row.user_id}</Table.Td>
									<Table.Td>
										<Text size="sm">{row.pack_title}</Text>
										<Text size="xs" c="dimmed">
											{row.pack_key} · 修订 {row.pack_revision_id}
										</Text>
									</Table.Td>
									<Table.Td>
										<Badge
											variant="light"
											color={row.status === "completed" ? "blue" : "teal"}
										>
											{sessionStatusLabel(row.status)}
										</Badge>
									</Table.Td>
									<Table.Td>{row.turn ?? "—"}</Table.Td>
									<Table.Td>
										{row.lost ? (
											<Badge color="red" variant="light">
												不可逆
											</Badge>
										) : (
											"—"
										)}
									</Table.Td>
									<Table.Td>
										<Text size="xs">{summaryText(row.summary) || "—"}</Text>
									</Table.Td>
									<Table.Td>
										<Text size="xs">
											{formatShortDateTime(row.updated_at ?? row.created_at)}
										</Text>
									</Table.Td>
									<Table.Td>
										<Button
											size="compact-sm"
											variant="light"
											onClick={() => setSelectedId(row.id)}
										>
											回放
										</Button>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}

			{total > PAGE_SIZE && (
				<Group justify="space-between">
					<Text size="xs" c="dimmed">
						第 {offset + 1}–{offset + rows.length} 次，共 {total} 次
					</Text>
					<Pagination
						total={pages}
						value={page}
						onChange={setPage}
						size="sm"
						withEdges
						aria-label="会话分页"
					/>
				</Group>
			)}

			{selectedId !== null && (
				<Paper withBorder p="md">
					{detailQuery.isLoading ? (
						<Group justify="center" py="xl">
							<Loader size="sm" />
						</Group>
					) : detailQuery.isError || detail === null ? (
						<Text size="sm" c="red">
							这次会话的详情读取失败。
						</Text>
					) : (
						<Stack gap="md">
							<Group justify="space-between" align="baseline">
								<Text fw={600}>
									会话 #{detail.session.id} · {detail.session.pack_title}
								</Text>
								<Group gap="xs">
									<Badge variant="light">
										{sessionStatusLabel(detail.session.status)}
									</Badge>
									<Text size="xs" c="dimmed">
										{detail.event_count} 条事件
									</Text>
									<Button
										size="compact-sm"
										variant="subtle"
										onClick={() => setSelectedId(null)}
									>
										收起
									</Button>
								</Group>
							</Group>

							<Alert
								color="orange"
								variant="light"
								icon={<IconAlertTriangle size={16} />}
							>
								诊断信息仅维护者可见：下面是每回合的问题清单（学生侧看不到这些原始串）。
							</Alert>

							<div>
								<Text size="sm" fw={600} mb={4}>
									问题清单（{detail.problems.length}）
								</Text>
								{detail.problems.length === 0 ? (
									<Text size="xs" c="dimmed">
										这次会话没有诊断问题。
									</Text>
								) : (
									<Stack gap={4}>
										{detail.problems.map((problem, index) => (
											<Code key={`${index}-${problem}`} block>
												{problem}
											</Code>
										))}
									</Stack>
								)}
							</div>

							{detail.report ? (
								<div className="sc-root" data-lost={detail.report.lost}>
									<ScenarioReportView
										report={detail.report}
										view={detail.view}
										actions={null}
										showWeights
									/>
								</div>
							) : (
								<Text size="sm" c="dimmed">
									这次会话还没有结算，所以没有报告——下面是它此刻的视图。
								</Text>
							)}

							<div>
								<Text size="sm" fw={600} mb={4}>
									回放视图（只读）
								</Text>
								<div className="sc-root">
									<div className="sc-column">
										<ScenarioStage view={detail.view} />
										<section
											className="sc-panel"
											aria-label="全部台词（回放）"
										>
											<div className="sc-panel-head">
												<span>全部台词</span>
												<span>{detail.view.messages.length} 条</span>
											</div>
											<div className="sc-panel-body">
												{detail.view.messages.length === 0 ? (
													<div className="sc-empty">
														这次会话还没有台词。
													</div>
												) : (
													<div className="sc-lines sc-lines-full">
														{detail.view.messages.map((message, index) => (
															<ScenarioLine
																key={`${message.turn ?? "x"}-${index}-${message.text.slice(0, 8)}`}
																message={message}
																view={detail.view}
															/>
														))}
													</div>
												)}
											</div>
										</section>
									</div>
									<ScenarioSidePanel view={detail.view} />
								</div>
							</div>

							<div>
								<Text size="sm" fw={600} mb={4}>
									事件流（{detail.events.length}）
								</Text>
								<Stack gap={6}>
									{detail.events.map((event, index) => (
										<details key={`${index}-${event.kind}`}>
											<summary>
												{index + 1}. {event.kind}
											</summary>
											<Code block>
												{JSON.stringify(event.payload, null, 2)}
											</Code>
										</details>
									))}
								</Stack>
							</div>
						</Stack>
					)}
				</Paper>
			)}
		</Stack>
	);
}
