import { ActionIcon, Alert, Anchor, Badge, Box, Button, Group, Loader, Paper, Select, Stack, Switch, Table, Text } from "@mantine/core";
import { IconAlertCircle, IconArchive, IconPencil, IconRefresh, IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import ListPage from "@/components/ui/list-page";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import TableScroll from "@/components/ui/table-scroll";
import { ACTIVITY_LABELS } from "@/config/activity-display";
import { WIDTH } from "@/config/layout-scale";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { CaseStatusBadge } from "./CaseStatusBadge";
import { generationOf } from "./case-generations";
import { CASE_STATUS_FILTER_OPTIONS } from "./caseStatus";

type CaseManageItem = components["schemas"]["CaseManageItem"];

/** 病例库筛选条件（CasesTab 持有状态，列表只做展示与回调）。 */
export interface CaseListFilters {
	name: string;
	difficulty: string;
	/** 生命周期："" = 全部（不含归档）/ draft / published / archived */
	status: string;
	is_open: string;
}

interface CaseListProps {
	cases: CaseManageItem[];
	total: number;
	offset: number;
	limit: number;
	filters: CaseListFilters;
	/** 是否存在活跃筛选（由 useListFilters.hasActiveFilters 统一判定，勿在此重复拼谓词） */
	hasFilters: boolean;
	searchInput: string;
	loading?: boolean;
	error?: boolean;
	/** 正在发布/归档/删除的病例 id（行内 pending）。 */
	pendingId?: number | null;
	/** 页头（PageHeader）：由 CasesTab 传入，主行动进页头，列表工具条不再放按钮。 */
	header?: ReactNode;
	onSearchChange: (value: string) => void;
	onFilterChange: (filters: CaseListFilters) => void;
	onOffsetChange: (offset: number) => void;
	onRetry?: () => void;
	/**
	 * 编辑入口的地址（病例工作台页）。这里渲染的是**真链接**，不是按钮回调：
	 * 中键/新标签能开、地址能复制，刷新回到同一份病例。
	 */
	caseHref: (id: number) => string;
	onDelete: (c: CaseManageItem) => void;
	onToggleOpen: (c: CaseManageItem) => void;
	onArchive: (c: CaseManageItem) => void;
}

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };

function CapabilityBadges({ caps }: { caps: Record<string, boolean> | undefined }) {
	if (!caps) return null;
	const enabled = Object.entries(ACTIVITY_LABELS).filter(([key]) => caps[key]);
	if (enabled.length === 0) return <Text size="xs" c="dimmed" opacity={0.4}>—</Text>;
	return (
		<Group gap={4}>
			{enabled.map(([key, label]) => (
				<Badge key={key} variant="light" color="gray" size="xs">{label}</Badge>
			))}
		</Group>
	);
}

interface CaseMobileCardProps {
	c: CaseManageItem;
	busy: boolean;
	caseHref: (id: number) => string;
	onDelete: (c: CaseManageItem) => void;
	onToggleOpen: (c: CaseManageItem) => void;
	onArchive: (c: CaseManageItem) => void;
}

/**
 * 手机端的一张病例卡（`sm` 以下唯一可访问的形态）。
 *
 * 卡片与桌面表格**同一时间只渲染一组**（由 CaseList 的 useMediaQuery 分支决定，不是
 * CSS 隐藏）：两套同时进 DOM 会让读屏与 `getByRole` 各读到一份，学生可见开关也变成
 * 两个同名控件。操作回调沿用父层传下来的同一批 handler —— 归档/删除的确认与请求都
 * 在 CasesTab 里，这里不另造。
 *
 * 不设固定列宽、长名称换行（桌面表格用 truncate，手机上截断等于看不到病例名）。
 */
function CaseMobileCard({ c, busy, caseHref, onDelete, onToggleOpen, onArchive }: CaseMobileCardProps) {
	const published = c.status === "published";
	const archived = c.status === "archived";
	const patientMeta = [c.patient_name, c.patient_gender, c.patient_age != null ? `${c.patient_age}岁` : null]
		.filter(Boolean)
		.join(" · ");

	return (
		<Paper withBorder p="sm" data-testid="case-card">
			<Group gap={6} align="flex-start" wrap="nowrap">
				<Anchor
					component={Link}
					to={caseHref(c.id)}
					size="sm"
					fw={600}
					style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", whiteSpace: "normal" }}
					title={archived ? "查看已归档病例" : "打开病例工作台"}
				>
					{c.name}
				</Anchor>
				<Badge size="xs" variant="light" color={c.workflow?.id === "clinical_reasoning" ? "teal" : "blue"} style={{ flexShrink: 0 }}>
					{generationOf(c.workflow?.id).generation}
				</Badge>
			</Group>

			<Text size="xs" c="dimmed" mt={4} style={{ overflowWrap: "anywhere" }}>{patientMeta}</Text>

			<Group gap="xs" mt="xs" wrap="wrap">
				<Text size="xs">{DIFFICULTY_LABELS[c.difficulty ?? 1]}</Text>
				<CaseStatusBadge status={c.status} revisionNo={c.current_revision_no} />
			</Group>

			<Group gap="xs" mt="xs" justify="space-between" wrap="nowrap">
				{published ? (
					<Group gap={6} wrap="nowrap">
						<Switch
							size="xs"
							checked={c.is_open}
							onChange={() => onToggleOpen(c)}
							disabled={busy}
							aria-label={`学生可见 ${c.name}`}
						/>
						<Text size="xs" c="dimmed">学生可见</Text>
					</Group>
				) : (
					<Text size="xs" c="dimmed">{archived ? "不可用" : "待发布"}</Text>
				)}

				<Group gap={4} wrap="nowrap">
					<ActionIcon
						component={Link}
						to={caseHref(c.id)}
						variant="subtle"
						color="gray"
						size="md"
						aria-label={archived ? "查看" : "编辑"}
						title={archived ? "已归档病例内容冻结，仅可查看" : "编辑"}
					>
						<IconPencil size={15} />
					</ActionIcon>
					{!archived && (
						<ActionIcon
							variant="subtle"
							color="orange"
							size="md"
							onClick={() => onArchive(c)}
							aria-label="归档"
							title="归档（不再用于新作业与训练，历史训练保留）"
							disabled={busy}
						>
							<IconArchive size={15} />
						</ActionIcon>
					)}
					<ActionIcon
						variant="subtle"
						color="red"
						size="md"
						onClick={() => onDelete(c)}
						aria-label="删除"
						title="删除"
						disabled={busy}
					>
						<IconTrash size={15} />
					</ActionIcon>
				</Group>
			</Group>
		</Paper>
	);
}

/** 手机卡片的空态 / 加载态：与表格里的那两句文案同源，避免两种措辞。 */
function CaseMobileEmpty({ loading, hasFilters }: { loading?: boolean; hasFilters: boolean }) {
	if (loading) {
		return (
			<Group justify="center" gap={8} py="lg">
				<Loader size={16} />
				<Text size="sm" c="dimmed">加载中…</Text>
			</Group>
		);
	}
	return (
		<Stack align="center" gap={4} py="lg">
			<Text size="sm" c="dimmed">{hasFilters ? "没有符合条件的病例" : "尚未创建病例"}</Text>
			<Text size="xs" c="dimmed">
				{hasFilters ? "试试放宽筛选条件" : "新建的病例是草稿，编辑完成后「发布」才能用于作业与训练"}
			</Text>
		</Stack>
	);
}

export default function CaseList({
	cases, total, offset, limit,
	filters, hasFilters, searchInput, loading, error, pendingId,
	header, onSearchChange, onFilterChange, onOffsetChange, onRetry, caseHref,
	onDelete, onToggleOpen, onArchive,
}: CaseListProps) {
	/**
	 * 分界 = Mantine `sm` = WIDTH.phoneShell(768px)，宽度 ≤767px 走卡片。
	 * 桌面表格的最小宽是 720px，768px 以下放进表格必然横向滚动，所以这一页取 `sm`
	 * 而不是 ResponsiveTable 默认的 `md`（992px，那份是给宽表格用的）。
	 *
	 * 用 JS 分支而不是 `visibleFrom/hiddenFrom` 的 CSS 隐藏：CSS 隐藏只是看不见，
	 * 两套行仍在 DOM 里，读屏会读两遍、`getByRole("checkbox")` 会命中两个同名开关。
	 */
	const isMobile = useMediaQuery(`(max-width: ${WIDTH.phoneShell - 1}px)`);

	return (
		<ListPage
			header={header}
			toolbar={
				<FilterToolbar
					compact
					hasActiveFilters={hasFilters}
					onClear={() => {
						// 名称搜索走独立回调，必须一起复位（否则清除后输入框仍有值）
						onSearchChange("");
						onFilterChange({ name: "", difficulty: "", status: "", is_open: "" });
						onOffsetChange(0);
					}}
					search={
						<Box w={180}>
							<SearchInput
								size="xs"
								value={searchInput}
								onChange={onSearchChange}
								placeholder="搜索病例…"
								aria-label="搜索病例"
							/>
						</Box>
					}
					filters={
						<>
							<Select
								data={[...CASE_STATUS_FILTER_OPTIONS]}
								value={filters.status || "all"}
								onChange={(v) => onFilterChange({ ...filters, status: v === "all" ? "" : v ?? "" })}
								placeholder="全部状态"
								size="xs"
								w={130}
								allowDeselect={false}
								aria-label="按生命周期筛选"
							/>
							<Select
								data={[{ value: "all", label: "全部难度" }, { value: "1", label: "初级" }, { value: "2", label: "中级" }, { value: "3", label: "高级" }]}
								value={filters.difficulty || "all"}
								onChange={(v) => onFilterChange({ ...filters, difficulty: v === "all" ? "" : v ?? "" })}
								placeholder="全部难度"
								size="xs"
								w={110}
								allowDeselect={false}
								aria-label="按难度筛选"
							/>
							<Select
								data={[{ value: "all", label: "全部可见" }, { value: "true", label: "已开放" }, { value: "false", label: "未开放" }]}
								value={filters.is_open || "all"}
								onChange={(v) => onFilterChange({ ...filters, is_open: v === "all" ? "" : v ?? "" })}
								placeholder="全部可见"
								size="xs"
								w={110}
								allowDeselect={false}
								aria-label="按学生可见筛选"
							/>
						</>
					}
				/>
			}
			footer={total > limit ? <Pagination total={total} offset={offset} limit={limit} onChange={onOffsetChange} /> : undefined}
		>
			{error && (
				<Alert variant="light" color="red" mb="xs" icon={<IconAlertCircle size={16} />}>
					<Group justify="space-between" gap={8} wrap="wrap">
						<Text size="sm">加载病例列表失败，请检查网络后重试。</Text>
						{onRetry && (
							<Button size="xs" variant="light" color="red" leftSection={<IconRefresh size={13} />} onClick={onRetry}>
								重试
							</Button>
						)}
					</Group>
				</Alert>
			)}

			{isMobile ? (
				<Stack gap="xs" data-testid="case-card-list">
					{cases.length === 0 ? (
						<CaseMobileEmpty loading={loading} hasFilters={hasFilters} />
					) : (
						cases.map((c) => (
							<CaseMobileCard
								key={c.id}
								c={c}
								busy={pendingId === c.id}
								caseHref={caseHref}
								onDelete={onDelete}
								onToggleOpen={onToggleOpen}
								onArchive={onArchive}
							/>
						))
					)}
				</Stack>
			) : (
				<>
					{/* Table（桌面 ≥768px 保留现表格；手机走上方卡片，两组不会同时进 DOM） */}
					{/* Table */}
					<Paper withBorder>
						<TableScroll minWidth={720}>
							<Table highlightOnHover horizontalSpacing="sm" verticalSpacing="xs">
								<Table.Thead>
									<Table.Tr>
										{/* 列宽按实用性分配：名称给足、能力徽章组不换行不抢宽（实测原为 344px > 名称 280px） */}
										<Table.Th style={{ minWidth: 260 }}><Text size="xs" c="dimmed" fw={600}>病例名称</Text></Table.Th>
										<Table.Th style={{ width: 72, whiteSpace: "nowrap" }}><Text size="xs" c="dimmed" fw={600}>难度</Text></Table.Th>
										<Table.Th style={{ width: 240, whiteSpace: "nowrap" }}><Text size="xs" c="dimmed" fw={600}>能力</Text></Table.Th>
										<Table.Th style={{ width: 132, whiteSpace: "nowrap" }}><Text size="xs" c="dimmed" fw={600}>状态</Text></Table.Th>
										<Table.Th style={{ textAlign: "center" }}><Text size="xs" c="dimmed" fw={600}>学生可见</Text></Table.Th>
										<Table.Th style={{ textAlign: "center" }}><Text size="xs" c="dimmed" fw={600}>操作</Text></Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{cases.length === 0 && (
										<Table.Tr>
											<Table.Td colSpan={6}>
												{loading ? (
													<Group justify="center" gap={8} py="lg">
														<Loader size={16} />
														<Text size="sm" c="dimmed">加载中…</Text>
													</Group>
												) : (
													<Stack align="center" gap={4} py="lg">
														<Text size="sm" c="dimmed">{hasFilters ? "没有符合条件的病例" : "尚未创建病例"}</Text>
														<Text size="xs" c="dimmed">
															{hasFilters ? "试试放宽筛选条件" : "新建的病例是草稿，编辑完成后「发布」才能用于作业与训练"}
														</Text>
													</Stack>
												)}
											</Table.Td>
										</Table.Tr>
									)}
									{cases.map((c) => {
										const published = c.status === "published";
										const archived = c.status === "archived";
										const busy = pendingId === c.id;
										return (
											<Table.Tr key={c.id}>
												<Table.Td>
													<Group gap={6} wrap="nowrap">
														<Anchor
															component={Link}
															to={caseHref(c.id)}
															size="xs"
															fw={500}
															truncate
															style={{ display: "block", flex: 1, minWidth: 0 }}
															title={archived ? "查看已归档病例" : "打开病例工作台"}
														>
															{c.name}
														</Anchor>
														<Badge size="xs" variant="light" color={c.workflow?.id === "clinical_reasoning" ? "teal" : "blue"}>
															{generationOf(c.workflow?.id).generation}
														</Badge>
													</Group>
													<Text size="xs" c="dimmed" truncate mt={2}>
														{[c.patient_gender, c.patient_age != null ? `${c.patient_age}岁` : null].filter(Boolean).join(" · ")}
													</Text>
												</Table.Td>
												<Table.Td><Text size="xs">{DIFFICULTY_LABELS[c.difficulty ?? 1]}</Text></Table.Td>
												<Table.Td><CapabilityBadges caps={c.capabilities} /></Table.Td>
												<Table.Td>
													<CaseStatusBadge status={c.status} revisionNo={c.current_revision_no} />
												</Table.Td>
												<Table.Td style={{ textAlign: "center" }}>
													{published ? (
														<Switch
															size="xs"
															checked={c.is_open}
															onChange={() => onToggleOpen(c)}
															disabled={busy}
															aria-label={`学生可见 ${c.name}`}
														/>
													) : (
														<Text size="xs" c="dimmed">
															{archived ? "不可用" : "待发布"}
														</Text>
													)}
												</Table.Td>
												<Table.Td>
													{/* 图标按钮：换行会让操作列变高，故 nowrap；删除与其它拉开 6px 间距，防误点 */}
													<Group gap={6} justify="center" wrap="nowrap">
														<ActionIcon
															component={Link}
															to={caseHref(c.id)}
															variant="subtle"
															color="gray"
															size="sm"
															aria-label={archived ? "查看" : "编辑"}
															title={archived ? "已归档病例内容冻结，仅可查看" : "编辑"}
														>
															<IconPencil size={14} />
														</ActionIcon>
														{!archived && (
															<ActionIcon
																variant="subtle"
																color="orange"
																size="sm"
																onClick={() => onArchive(c)}
																aria-label="归档"
																title="归档（不再用于新作业与训练，历史训练保留）"
																disabled={busy}
															>
																<IconArchive size={14} />
															</ActionIcon>
														)}
														<ActionIcon
															variant="subtle"
															color="red"
															size="sm"
															style={{ marginLeft: 6 }}
															onClick={() => onDelete(c)}
															aria-label="删除"
															title="删除"
															disabled={busy}
														>
															<IconTrash size={14} />
														</ActionIcon>
													</Group>
												</Table.Td>
											</Table.Tr>
										);
									})}
								</Table.Tbody>
							</Table>
						</TableScroll>
					</Paper>
				</>
			)}
		</ListPage>
	);
}
