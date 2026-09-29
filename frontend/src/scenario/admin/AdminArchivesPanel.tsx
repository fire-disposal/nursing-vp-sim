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
	TextInput,
} from "@mantine/core";
import { IconAlertTriangle, IconArchive, IconLock } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	getAdminScenarioArchive,
	listAdminScenarioArchives,
} from "@/api/scenario";
import { formatShortDateTime } from "@/utils/date";
import { getApiErrorMessage } from "@/utils/error";
import ScenarioReportView from "../ScenarioReportView";
import ScenarioSidePanel from "../ScenarioSidePanel";
import ScenarioStage, { ScenarioLine } from "../ScenarioStage";
import { sessionStatusLabel } from "../sessions";
import AdminFocusPanel from "./AdminFocusPanel";

/** 每页条数：`limit` 是服务端真实参数，这里只提供几个刻度（含 10，便于逐页核对少量归档）。 */
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

/**
 * 归档里记录的结束原因（`summary.ended_reason`）——归档脚本写的是**结局状态码**
 * （`runtime/archive.py`：新形状取 `outcome.status`，旧报告退化成 `lost` / `completed`，
 * 切换时封存的旧活动局是 `mechanism_cutover`）。认不出的取值**原样显示**，不假装认识。
 */
const ENDED_REASON: Record<string, string> = {
	lost: "不可逆结局",
	ended_by_student: "学生主动结束",
	completed: "正常结束",
	cutover: "机制切换封存",
	mechanism_cutover: "机制切换封存",
	abandoned: "切换时封存",
};

function endedReasonLabel(reason: string): string {
	if (reason === "") return "—";
	return ENDED_REASON[reason] ?? reason;
}

/**
 * 历史归档（docs/23 §9、handoff §9）——**只读浏览器**。
 *
 * 归档表 `st_session_archives` 按原会话 id 唯一存下机制切换前旧局的投影与形状版本；原始
 * `st_events` / `st_pack_revisions` 保留不动。这一块因此**只做投影**，三件事一律不做：
 * 不重算、不补生成、不写。这里没有删除/结束/编辑/重新生成，连禁用按钮也没有——不是"暂时灰着"，
 * 而是这个界面的职责里就没有写操作（写属于 `st_*` 原始链路，不属于归档）。
 *
 * 报告三态**不合并**（与 `AdminSessionsPanel` 同一口径，但读的是归档字段名）：
 * - `report` 是新形状报告（有就按新形状展示）；
 * - `legacy_report` 是切换前的原报告，**原样 JSON 只读**，绝不翻译成 `ScenarioReport`、绝不重算；
 * - 两者都没有 = 「未结算（原有报告就不存在）」——旧局原无报告就留空，不替它生成一份成绩。
 */
export default function AdminArchivesPanel() {
	/** 分页与筛选就是组件状态，也是请求参数：换页即换请求，不共用缓存。 */
	const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
	const [offset, setOffset] = useState(0);
	/** 已应用的病例筛选（服务端 `pack_key` 参数）。 */
	const [packKey, setPackKey] = useState<string | null>(null);
	/** 输入框里的草稿：只有按「筛选」或回车才换成请求（不每敲一个字就打一次接口）。 */
	const [packDraft, setPackDraft] = useState("");
	const [selectedId, setSelectedId] = useState<number | null>(null);

	const query = { pack_key: packKey, limit, offset };
	const listQuery = useQuery({
		queryKey: [...queryKeys.scenario.admin.all, "archives", query] as const,
		queryFn: () => listAdminScenarioArchives(query),
	});

	const rows = listQuery.data?.items ?? [];
	const total = listQuery.data?.total ?? 0;
	const pages = Math.max(1, Math.ceil(total / limit));
	const page = Math.floor(offset / limit) + 1;

	/**
	 * 筛选候选只来自**已经取回来的行**：不另拉一份病例清单、不猜服务端还有哪些病例，
	 * 也不预设选项。筛选生效时这行候选自然只剩选中的那个病例。
	 */
	const rowPacks = Array.from(new Set(rows.map((row) => row.pack_key))).sort();

	const applyPack = (value: string) => {
		const next = value.trim();
		setPackDraft(next);
		setPackKey(next === "" ? null : next);
		setOffset(0);
		setSelectedId(null);
	};

	return (
		<Stack gap="md">
			<Alert
				color="gray"
				variant="light"
				icon={<IconLock size={16} />}
				title="归档只读"
			>
				<Text size="xs">
					归档 = 机制切换前的旧局投影（按原会话 id 唯一留档，形状版本一并记下）：
					<b>不重算、不补生成</b>，这里也没有任何写操作。报告原来不存在就标「未结算」——
					不替旧局生成一份新成绩，也不把旧报告翻译成新形状。
				</Text>
			</Alert>

			<Group align="flex-end" gap="sm" wrap="wrap">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						applyPack(packDraft);
					}}
				>
					<Group align="flex-end" gap="xs">
						<TextInput
							label="病例 key"
							w={260}
							placeholder="全部病例（留空 = 全部）"
							value={packDraft}
							onChange={(event) => setPackDraft(event.currentTarget.value)}
							aria-label="按病例 key 筛选归档"
						/>
						<Button type="submit" size="compact-sm" variant="light">
							筛选
						</Button>
						{packKey !== null && (
							<Button
								type="button"
								size="compact-sm"
								variant="subtle"
								onClick={() => applyPack("")}
							>
								清除
							</Button>
						)}
					</Group>
				</form>
				<Select
					label="每页"
					w={110}
					data={PAGE_SIZES.map((value) => ({
						value: String(value),
						label: `${value} 条`,
					}))}
					value={String(limit)}
					onChange={(value) => {
						setLimit(Number(value) || DEFAULT_PAGE_SIZE);
						setOffset(0);
					}}
					allowDeselect={false}
					aria-label="每页条数"
				/>
				<Text size="xs" c="dimmed" pb={6}>
					共 {total} 局
					{total > 0 && ` · 第 ${page}/${pages} 页`}
					{packKey !== null && ` · 已筛选病例 ${packKey}`}
				</Text>
			</Group>

			{/* 候选来自本页返回的行；只有一个病例时不占位置（没有第二个选项可点）。 */}
			{packKey === null && rowPacks.length > 1 && (
				<Group gap={6} wrap="wrap">
					<Text size="xs" c="dimmed">
						本页出现的病例：
					</Text>
					{rowPacks.map((key) => (
						<Button
							key={key}
							type="button"
							size="compact-xs"
							variant="light"
							onClick={() => applyPack(key)}
						>
							{key}
						</Button>
					))}
				</Group>
			)}

			{listQuery.isLoading ? (
				<Group justify="center" py="xl">
					<Loader size="sm" />
				</Group>
			) : listQuery.isError ? (
				<Stack align="flex-start" gap="xs">
					<Text size="sm" c="red">
						归档列表读取失败：
						{getApiErrorMessage(listQuery.error, "请确认有「数据查看」权限，或稍后重试。")}
					</Text>
					<Button
						type="button"
						size="compact-sm"
						variant="light"
						onClick={() => listQuery.refetch()}
					>
						重试
					</Button>
				</Stack>
			) : rows.length === 0 ? (
				<Text size="sm" c="dimmed">
					{packKey !== null ? `没有「${packKey}」这个病例的归档。` : "还没有归档。"}
				</Text>
			) : (
				<Table.ScrollContainer minWidth={1000}>
					<Table highlightOnHover verticalSpacing="xs">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>会话 #</Table.Th>
								<Table.Th>病例</Table.Th>
								<Table.Th>形状版本</Table.Th>
								<Table.Th>状态</Table.Th>
								<Table.Th>时间单位</Table.Th>
								<Table.Th>结束原因</Table.Th>
								<Table.Th>归档时间</Table.Th>
								<Table.Th>报告</Table.Th>
								<Table.Th>操作</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{rows.map((row) => (
								<Table.Tr
									key={row.session_id}
									onClick={() => setSelectedId(row.session_id)}
									style={{ cursor: "pointer" }}
								>
									<Table.Td>{row.session_id}</Table.Td>
									<Table.Td>
										<Text size="sm">{row.pack_key}</Text>
										<Text size="xs" c="dimmed">
											修订 {row.pack_revision_id}
										</Text>
									</Table.Td>
									<Table.Td>
										<Badge variant="outline" color="gray">
											v{row.shape_version}
										</Badge>
									</Table.Td>
									<Table.Td>
										<Badge
											variant="light"
											color={row.status === "completed" ? "blue" : "gray"}
										>
											{sessionStatusLabel(row.status)}
										</Badge>
									</Table.Td>
									{/* `turn` 是情境时间单位累计值，不是"第 N 回合 / 提交次数"。 */}
									<Table.Td>{row.turn}</Table.Td>
									<Table.Td>
										<Text size="xs">{endedReasonLabel(row.ended_reason)}</Text>
									</Table.Td>
									<Table.Td>
										<Text size="xs">{formatShortDateTime(row.archived_at)}</Text>
									</Table.Td>
									<Table.Td>
										{row.has_report ? (
											<Badge variant="light" color="teal">
												有
											</Badge>
										) : (
											<Badge variant="outline" color="gray">
												未结算
											</Badge>
										)}
									</Table.Td>
									<Table.Td>
										{/* 整行可点（方便），这个按钮给出可读的动作名（无障碍）——两者同一动作。 */}
										<Button
											size="compact-sm"
											variant="light"
											onClick={() => setSelectedId(row.session_id)}
										>
											查看
										</Button>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}

			{total > limit && (
				<Group justify="space-between" wrap="wrap">
					<Text size="xs" c="dimmed">
						第 {offset + 1}–{offset + rows.length} 局，共 {total} 局
					</Text>
					<Pagination
						total={pages}
						value={page}
						onChange={(next) => {
							setOffset((next - 1) * limit);
							setSelectedId(null);
						}}
						size="sm"
						withEdges
						aria-label="归档分页"
					/>
				</Group>
			)}

			{selectedId !== null && (
				<Paper withBorder p="md">
					<ArchiveDetail sessionId={selectedId} onClose={() => setSelectedId(null)} />
				</Paper>
			)}
		</Stack>
	);
}

/**
 * 一条归档的详情。**独立组件、独立查询**：详情只在展开时挂载（`enabled`），
 * 展开的那一条换掉就是换 key，不会把上一条的数据当成这一条渲染。
 */
function ArchiveDetail({
	sessionId,
	onClose,
}: {
	sessionId: number;
	onClose: () => void;
}) {
	const detailQuery = useQuery({
		queryKey: [...queryKeys.scenario.admin.all, "archive", sessionId] as const,
		queryFn: () => getAdminScenarioArchive(sessionId),
	});
	const detail = detailQuery.data ?? null;

	if (detailQuery.isLoading) {
		return (
			<Group justify="center" py="xl">
				<Loader size="sm" />
			</Group>
		);
	}
	if (detailQuery.isError || detail === null) {
		return (
			<Stack align="flex-start" gap="xs">
				<Text size="sm" c="red">
					这次归档的详情读取失败：
					{getApiErrorMessage(detailQuery.error, "请稍后重试。")}
				</Text>
				<Button
					type="button"
					size="compact-sm"
					variant="light"
					onClick={() => detailQuery.refetch()}
				>
					重试
				</Button>
			</Stack>
		);
	}

	const summary = detail.summary;
	// 生成物里这几项都是可选的：用空值兜住，界面按"没有"渲染，不把 undefined 当 0。
	const messages = detail.view.messages ?? [];
	const focus = detail.focus ?? [];
	const turns = detail.turns ?? [];
	const events = detail.raw?.events ?? [];
	const packRevision = detail.raw?.pack_revision ?? {};

	return (
		<Stack gap="md">
			<Group justify="space-between" align="baseline" wrap="wrap">
				<Group gap="xs" align="baseline" wrap="wrap">
					<Text fw={600}>
						归档会话 #{summary.session_id} · {summary.pack_key}
					</Text>
					<Badge variant="outline" color="gray">
						形状版本 v{summary.shape_version}
					</Badge>
					<Badge
						variant="light"
						color={summary.status === "completed" ? "blue" : "gray"}
					>
						{sessionStatusLabel(summary.status)}
					</Badge>
					<Text size="xs" c="dimmed">
						时间单位 {summary.turn} · 修订 {summary.pack_revision_id} · 归档于{" "}
						{formatShortDateTime(summary.archived_at) || "（无时间）"}
						{summary.ended_reason !== "" &&
							` · 结束原因 ${endedReasonLabel(summary.ended_reason)}`}
					</Text>
				</Group>
				<Button type="button" size="compact-sm" variant="subtle" onClick={onClose}>
					收起
				</Button>
			</Group>

			<Alert color="gray" variant="light" icon={<IconArchive size={16} />}>
				<Text size="xs">
					这是<b>机制切换前</b>的旧局留档：只按当时的记录展示，不重算、不补生成；
					旧报告原样放着，不会被翻译成新形状，也不会重新判读。
				</Text>
			</Alert>

			{detail.report != null ? (
				<div className="sc-root" data-lost={detail.report.outcome.lost}>
					<Group justify="space-between" align="baseline" mb={6} gap="xs" wrap="wrap">
						<Text size="sm" fw={600}>
							归档报告
						</Text>
						<Text size="xs" c="dimmed">
							归档时已存在的新形状报告 · 不重算
						</Text>
					</Group>
					<ScenarioReportView
						report={detail.report}
						view={detail.view}
						actions={null}
						showWeights
					/>
				</div>
			) : detail.legacy_report != null ? (
				<Stack gap="xs">
					<Group justify="space-between" align="baseline" gap="xs" wrap="wrap">
						<Text size="sm" fw={600}>
							切换前原始报告，未重算
						</Text>
						<Text size="xs" c="dimmed">
							旧机制写下的报告原文 · 原样只读
						</Text>
					</Group>
					<Code block>{JSON.stringify(detail.legacy_report, null, 2)}</Code>
				</Stack>
			) : (
				<Text size="sm" c="dimmed">
					未结算（原有报告就不存在）：这一局在机制切换前就没有留下报告，这里不替它补生成。
				</Text>
			)}

			<div>
				<Text size="sm" fw={600} mb={4}>
					归档视图（只读）
				</Text>
				<div className="sc-root">
					<div className="sc-column">
						<ScenarioStage view={detail.view} />
						<section className="sc-panel" aria-label="全部台词（归档）">
							<div className="sc-panel-head">
								<span>全部台词</span>
								<span>{messages.length} 条</span>
							</div>
							<div className="sc-panel-body">
								{messages.length === 0 ? (
									<div className="sc-empty">这一局没有留下台词。</div>
								) : (
									<div className="sc-lines sc-lines-full">
										{messages.map((message) => (
											<ScenarioLine
												key={message.id}
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

			<AdminFocusPanel focus={focus} turns={turns} />

			<div>
				<Text size="sm" fw={600} mb={4}>
					维护者视图
				</Text>
				<Text size="xs" c="dimmed" mb={6}>
					归档时保留的原始事件与包修订快照（内部记录，学生侧看不到）：只用于核对留档，
					不是重新执行的入口——归档不会据此重算。
				</Text>
				<Alert
					color="orange"
					variant="light"
					icon={<IconAlertTriangle size={16} />}
					mb={6}
				>
					<Text size="xs">
						原始事件里可能含内部字段与诊断串，请勿截图转发给学生。
					</Text>
				</Alert>
				<details>
					<summary>原始事件（{events.length} 条）与包修订快照</summary>
					<Stack gap={6} mt={6}>
						{events.length === 0 ? (
							<Text size="xs" c="dimmed">
								这条归档没有原始事件记录。
							</Text>
						) : (
							events.map((event, index) => (
								<details key={`${index}-${event.kind}`}>
									<summary>
										{index + 1}. {event.kind}
									</summary>
									<Code block>{JSON.stringify(event.payload ?? {}, null, 2)}</Code>
								</details>
							))
						)}
						<Text size="xs" fw={600} mt={4}>
							包修订快照（{summary.pack_key} · 修订 {summary.pack_revision_id}）
						</Text>
						{Object.keys(packRevision).length === 0 ? (
							<Text size="xs" c="dimmed">
								这条归档没有留包修订快照。
							</Text>
						) : (
							<Code block>{JSON.stringify(packRevision, null, 2)}</Code>
						)}
					</Stack>
				</details>
			</div>
		</Stack>
	);
}
