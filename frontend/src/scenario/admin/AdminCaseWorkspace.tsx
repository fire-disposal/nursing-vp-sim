import { Badge, Button, Code, Group, Paper, Tabs, Text } from "@mantine/core";
import { IconArrowLeft, IconChartBar, IconInfoCircle, IconPencil } from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { ScenarioAdminPack } from "@/api/scenario";
import AdminCaseEditorPanel from "./AdminCaseEditorPanel";
import AdminCaseOverviewPanel from "./AdminCaseOverviewPanel";
import AdminSessionsPanel from "./AdminSessionsPanel";
import AdminStatsPanel from "./AdminStatsPanel";

/** 病例工作区的分块。 */
export type CaseBlock = "overview" | "editor" | "sessions" | "stats";

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
 * 选了病例、切过来就没了"。图片的增删、这个病例的会话与统计，都是这个病例身上的块。
 *
 * 病例的新模型很简单：**当前内容 + 整数 `version`（内容变了才 +1）+ 是否上架**。
 * 没有"历史版本"这回事——所以块里也没有历史版本，头部只报版本与上架状态。
 *
 * **图片与散文不是单独的块**：它们都是"当前内容"的一部分，跟着编辑器的那几张页签走
 * （表单 / 散文 / 图片 / 原始）——同一个事实只有一处编辑入口。
 */
export default function AdminCaseWorkspace({
	pack,
	permissions,
	block,
	onBlock,
	onBack,
}: {
	pack: ScenarioAdminPack;
	permissions: string[];
	block: CaseBlock;
	onBlock: (block: CaseBlock) => void;
	onBack: () => void;
}) {
	const blocks = visibleCaseBlocks(permissions);
	const current = blocks.includes(block) ? block : (blocks[0] ?? null);
	// `assets` 是可选的：缺就是"这份病例没声明图片"，不当作空数组之外的别的东西。
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
					<Badge variant="light" color={pack.published ? "green" : "orange"}>
						{pack.published ? "已上架" : "未上架"}
					</Badge>
					<Code>{pack.key}</Code>
					<Text size="xs" c="dimmed">
						版本 #{pack.version} · {pack.sessions} 次会话 · 图片{" "}
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
				{current === "sessions" && <AdminSessionsPanel packKey={pack.key} lockPack />}
				{current === "stats" && <AdminStatsPanel packKey={pack.key} />}
			</Tabs>
		</>
	);
}
