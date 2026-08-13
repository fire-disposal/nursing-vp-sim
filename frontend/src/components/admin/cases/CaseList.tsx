import { IconPencil, IconPlus, IconSearch, IconTrash, IconWand, IconX } from "@tabler/icons-react";
import { ActionIcon, Badge, Box, Button, Group, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import Pagination from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import type { components } from "@/api/api-types.gen";

type CaseManageItem = components["schemas"]["CaseManageItem"];

interface CaseListProps {
	cases: CaseManageItem[];
	total: number;
	offset: number;
	limit: number;
	filters: { name: string; difficulty: string; training_type: string; is_open: string };
	searchInput: string;
	onSearchChange: (value: string) => void;
	onFilterChange: (filters: { name: string; difficulty: string; training_type: string; is_open: string }) => void;
	onOffsetChange: (offset: number) => void;
	onAdd: () => void;
	onAIAdd: () => void;
	onEdit: (c: CaseManageItem) => void;
	onDelete: (c: CaseManageItem) => void;
	onToggleOpen: (c: CaseManageItem) => void;
}

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const STATUS_LABELS: Record<string, string> = { history_taking: "病史采集" };

function CapabilityBadges({ caps }: { caps: Record<string, boolean> | undefined }) {
	if (!caps) return null;
	const defs = Object.entries(ALL_CAPABILITIES).filter(([, def]) => def.tier === "toggleable");
	const enabled = defs.filter(([key]) => caps[key]);
	if (enabled.length === 0) return <Text size="xs" c="dimmed" opacity={0.4}>—</Text>;
	return (
		<Group gap={4}>
			{enabled.map(([key, def]) => (
				<Badge key={key} variant="light" color="gray" size="xs">{def.label}</Badge>
			))}
		</Group>
	);
}

export default function CaseList({
	cases, total, offset, limit,
	filters, searchInput,
	onSearchChange, onFilterChange, onOffsetChange,
	onAdd, onAIAdd, onEdit, onDelete, onToggleOpen,
}: CaseListProps) {

	return (
		<Stack gap="md">
			{/* Toolbar */}
			<Group gap={8}>
				<Button size="sm" onClick={onAdd} leftSection={<IconPlus size={14} />}>新建病例</Button>
				<Button size="sm" variant="outline" onClick={onAIAdd} leftSection={<IconWand size={14} />}>AI 生成</Button>
				<div style={{ flex: 1 }} />
				<TextInput
					size="xs"
					w={180}
					value={searchInput}
					onChange={(e) => onSearchChange(e.currentTarget.value)}
					placeholder="搜索病例…"
					leftSection={<IconSearch size={14} />}
					rightSection={
						searchInput ? (
							<ActionIcon variant="subtle" color="gray" size="xs" onClick={() => onSearchChange("")} aria-label="清除搜索">
								<IconX size={12} />
							</ActionIcon>
						) : undefined
					}
				/>
			</Group>

			<Group gap={8}>
				<Box w={110}>
					<Select
						data={[{ value: "all", label: "全部难度" }, { value: "1", label: "初级" }, { value: "2", label: "中级" }, { value: "3", label: "高级" }]}
						value={filters.difficulty || "all"}
						onChange={(v) => onFilterChange({ ...filters, difficulty: v === "all" ? "" : v ?? "" })}
						placeholder="全部难度"
						size="xs"
						allowDeselect={false}
					/>
				</Box>
				<Box w={110}>
					<Select
						data={[{ value: "all", label: "全部状态" }, { value: "true", label: "已开放" }, { value: "false", label: "已关闭" }]}
						value={filters.is_open || "all"}
						onChange={(v) => onFilterChange({ ...filters, is_open: v === "all" ? "" : v ?? "" })}
						placeholder="全部状态"
						size="xs"
						allowDeselect={false}
					/>
				</Box>
			</Group>

			{/* Table */}
			<Paper withBorder radius="md" style={{ overflow: "auto" }}>
				<Table highlightOnHover miw={640} horizontalSpacing="sm" verticalSpacing="xs">
					<TableHeader>
						<TableRow>
							<TableHead><Text size="xs" c="dimmed" fw={600}>病例名称</Text></TableHead>
							<TableHead><Text size="xs" c="dimmed" fw={600}>难度</Text></TableHead>
							<TableHead><Text size="xs" c="dimmed" fw={600}>类型</Text></TableHead>
							<TableHead><Text size="xs" c="dimmed" fw={600}>能力</Text></TableHead>
							<TableHead style={{ textAlign: "center" }}><Text size="xs" c="dimmed" fw={600}>状态</Text></TableHead>
							<TableHead style={{ textAlign: "center" }}><Text size="xs" c="dimmed" fw={600}>操作</Text></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{cases.map((c) => (
							<TableRow key={c.id}>
								<TableCell>
									<Text size="xs" fw={500} truncate>{c.name}</Text>
									<Text size="xs" c="dimmed" truncate mt={2}>
										{[c.patient_gender, c.patient_age != null ? `${c.patient_age}岁` : null].filter(Boolean).join(" · ")}
									</Text>
								</TableCell>
								<TableCell><Text size="xs">{DIFFICULTY_LABELS[c.difficulty ?? 1]}</Text></TableCell>
								<TableCell><Text size="xs" c="dimmed">{STATUS_LABELS[c.training_type ?? "history_taking"] ?? c.training_type}</Text></TableCell>
								<TableCell><CapabilityBadges caps={c.capabilities} /></TableCell>
								<TableCell style={{ textAlign: "center" }}>
									<Button size="xs" variant="light" color={c.is_open ? "green" : "gray"} onClick={() => onToggleOpen(c)}>
										{c.is_open ? "开放" : "关闭"}
									</Button>
								</TableCell>
								<TableCell>
									<Group gap={4} justify="center">
										<ActionIcon variant="subtle" color="gray" size="sm" onClick={() => onEdit(c)} aria-label="编辑"><IconPencil size={14} /></ActionIcon>
										<ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(c)} aria-label="删除"><IconTrash size={14} /></ActionIcon>
									</Group>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Paper>

			{total > limit && <Pagination total={total} offset={offset} limit={limit} onChange={onOffsetChange} />}
		</Stack>
	);
}
