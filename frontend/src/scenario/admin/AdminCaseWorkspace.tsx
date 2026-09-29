import { Badge, Button, Code, Group, Paper, Tabs, Text } from "@mantine/core";
import {
	IconArrowLeft,
	IconChartBar,
	IconDatabase,
	IconHistory,
	IconInfoCircle,
	IconPencil,
	IconSparkles,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { ScenarioAdminPack } from "@/api/scenario";
import AdminAssetsPanel from "./AdminAssetsPanel";
import AdminCaseEditorPanel from "./AdminCaseEditorPanel";
import AdminCaseOverviewPanel from "./AdminCaseOverviewPanel";
import AdminCaseRevisionsPanel from "./AdminCaseRevisionsPanel";
import AdminGeneratedPanel from "./AdminGeneratedPanel";
import AdminSessionsPanel from "./AdminSessionsPanel";
import AdminStatsPanel from "./AdminStatsPanel";

/** 病例工作区的分块。 */
export type CaseBlock =
	| "overview"
	| "editor"
	| "revisions"
	| "assets"
	| "generated"
	| "sessions"
	| "stats";

/**
 * 分块与**权限键**的对应（与后端逐字一致：内容面 `case_manage`，数据面 `stats_view`）。
 *
 * 权限是**按块**判的：没有那一项权限，那个块就不出现——不是渲染一个空壳，
 * 也不是把整个工作区关掉（只要还有一块能看，工作区就成立）。
 */
export const CASE_BLOCKS: {
	id: CaseBlock;
	label: string;
	permission: "case_manage" | "stats_view";
	icon: ComponentType<{ size?: number }>;
}[] = [
	{ id: "overview", label: "概览", permission: "case_manage", icon: IconInfoCircle },
	{ id: "editor", label: "编辑", permission: "case_manage", icon: IconPencil },
	{ id: "revisions", label: "修订", permission: "case_manage", icon: IconHistory },
	{ id: "assets", label: "资源", permission: "case_manage", icon: IconDatabase },
	{ id: "generated", label: "生成物", permission: "case_manage", icon: IconSparkles },
	{ id: "sessions", label: "会话", permission: "stats_view", icon: IconChartBar },
	{ id: "stats", label: "统计", permission: "stats_view", icon: IconChartBar },
];

/** 当前权限下**可用**的分块（顺序即页签顺序）。 */
export function visibleCaseBlocks(permissions: string[]): CaseBlock[] {
	return CASE_BLOCKS.filter((block) => permissions.includes(block.permission)).map(
		(block) => block.id,
	);
}

/**
 * 病例工作区 —— 选中一个病例之后的**唯一入口**。
 *
 * 头部那一处病例信息就是**唯一**的病例选择：没有第二个选择器，也没有"在别的页签里
 * 选了病例、切过来就没了"。资源的增删、生成物的分页、这个病例的会话与统计，
 * 都是这个病例身上的块——它们之间不再互相跳转（本来就在同一个病例上）。
 */
export default function AdminCaseWorkspace({
	pack,
	permissions,
	block,
	onBlock,
	onBack,
	onOpenSession,
	focusSessionId,
}: {
	pack: ScenarioAdminPack;
	permissions: string[];
	block: CaseBlock;
	onBlock: (block: CaseBlock) => void;
	onBack: () => void;
	/** 「生成物」里点会话号 → 换到「会话」块并把那一次展开。 */
	onOpenSession: (sessionId: number) => void;
	focusSessionId: number | null;
}) {
	const blocks = visibleCaseBlocks(permissions);
	const current = blocks.includes(block) ? block : (blocks[0] ?? null);
	const reviewed = pack.state === "reviewed";
	// 生成物里 `assets` 是可选的：缺就是"这份病例没声明资源"，不当作空数组之外的别的东西。
	const assets = pack.assets ?? [];

	return (
		<>
			<Paper withBorder p="md" mb="md" className="sc-admin-case-head">
				<Group gap="xs" wrap="wrap" align="center">
					<Button
						variant="subtle"
						size="compact-sm"
						leftSection={<IconArrowLeft size={14} />}
						onClick={onBack}
					>
						返回病例列表
					</Button>
					<Text fw={600}>{pack.title}</Text>
					<Badge variant="light" color={reviewed ? "green" : "gray"}>
						{reviewed ? "已审" : "实验版"}
					</Badge>
					<Code>{pack.key}</Code>
					<Text size="xs" c="dimmed">
						修订 #{pack.revision_no ?? "—"} · {pack.sessions} 次会话 · 资源{" "}
						{assets.filter((asset) => asset.uploaded).length}/{assets.length}
					</Text>
				</Group>
				{pack.one_line !== "" && (
					<Text size="xs" c="dimmed" mt={6}>
						{pack.one_line}
					</Text>
				)}
			</Paper>

			<Tabs value={current} onChange={(value) => value && onBlock(value as CaseBlock)}>
				<Tabs.List mb="md" className="sc-admin-tabs">
					{CASE_BLOCKS.filter((item) => blocks.includes(item.id)).map((item) => (
						<Tabs.Tab
							key={item.id}
							value={item.id}
							leftSection={<item.icon size={15} />}
						>
							{item.label}
						</Tabs.Tab>
					))}
				</Tabs.List>

				{/* 每一块都独立挂载（`keepMounted={false}` 的等价语义）：换块不会把上一块的
				    分页/展开态带过来，也不会同时发几块的请求 */}
				{current === "overview" && <AdminCaseOverviewPanel pack={pack} />}
				{current === "editor" && <AdminCaseEditorPanel pack={pack} />}
				{current === "revisions" && <AdminCaseRevisionsPanel pack={pack} />}
				{current === "assets" && <AdminAssetsPanel pack={pack} />}
				{current === "generated" && (
					// 「会话」块（stats_view）不可见时不传跳转回调：生成物面板就只显示会话号，
					// 不给一个点了会跳到无权查看的块的按钮。
					<AdminGeneratedPanel
						pack={pack}
						onOpenSession={
							blocks.includes("sessions") ? onOpenSession : undefined
						}
					/>
				)}
				{current === "sessions" && (
					<AdminSessionsPanel
						packKey={pack.key}
						lockPack
						focusSessionId={focusSessionId}
					/>
				)}
				{current === "stats" && <AdminStatsPanel packKey={pack.key} />}
			</Tabs>
		</>
	);
}
