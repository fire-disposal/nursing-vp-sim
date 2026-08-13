import { ActionIcon, Box, Button, Divider, Group, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconBook2, IconDownload, IconEdit, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useState, useCallback, type ChangeEvent } from "react";
import type { ApiPath } from "@/api/api-path";
import { api } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";

// ── Types: raw from API vs editor format ──
interface RubricAnchor { score: number; description: string; }
interface RubricItem { id: string; name: string; anchors: RubricAnchor[]; }
interface RubricDimension { id: string; name: string; max: number; description?: string; items: RubricItem[]; }
interface RubricData { id: string; name: string; version: string; total_max: number; dimensions: RubricDimension[]; }

// Raw API types
interface RubricItemRaw { id: string; name: string; anchors: Record<string, string>; }
interface RubricDataRaw {
	id: string; name: string; version: string; total_max: number;
	scale: number; raw_max: number; raw_scale: number;
	dimensions: { id: string; name: string; max: number; description?: string; items: RubricItemRaw[] }[];
}

function anchorsToArray(raw: Record<string, string>): RubricAnchor[] {
	return Object.entries(raw)
		.map(([s, d]) => ({ score: Number(s), description: d }))
		.sort((a, b) => a.score - b.score);
}
function anchorsToRecord(arr: RubricAnchor[]): Record<string, string> {
	const rec: Record<string, string> = {};
	for (const a of arr) rec[String(a.score)] = a.description;
	return rec;
}
function rawToDraft(raw: RubricDataRaw): RubricData {
	return {
		id: raw.id, name: raw.name, version: raw.version, total_max: raw.total_max,
		dimensions: raw.dimensions.map((d) => ({
			id: d.id, name: d.name, max: d.max, description: d.description,
			items: d.items.map((i) => ({ id: i.id, name: i.name, anchors: anchorsToArray(i.anchors) })),
		})),
	};
}
function draftToExport(draft: RubricData): RubricDataRaw {
	return {
		id: draft.id, name: draft.name, version: draft.version,
		total_max: draft.total_max, scale: 1, raw_max: draft.total_max, raw_scale: 1,
		dimensions: draft.dimensions.map((d) => ({
			id: d.id, name: d.name, max: d.max, description: d.description,
			items: d.items.map((i) => ({ id: i.id, name: i.name, anchors: anchorsToRecord(i.anchors) })),
		})),
	};
}

function _cloneRubric(r: RubricData): RubricData { return JSON.parse(JSON.stringify(r)); }

function downloadJson(data: unknown, filename: string) {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url; a.download = filename; a.click();
	URL.revokeObjectURL(url);
}

// ── Anchor Row ──
function AnchorRow({ anchor, onChange, onDelete }: { anchor: RubricAnchor; onChange: (a: RubricAnchor) => void; onDelete: () => void }) {
	return (
		<Group gap={8} align="center" wrap="nowrap">
			<Input type="number" value={anchor.score} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...anchor, score: Number(e.target.value) })} size="xs" w={64} min={0} />
			<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>分 -</Text>
			<Input value={anchor.description} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...anchor, description: e.target.value })} size="xs" style={{ flex: 1 }} placeholder="锚点描述…" />
			<ActionIcon variant="subtle" color="gray" onClick={onDelete} aria-label="删除锚点">
				<IconTrash size={14} />
			</ActionIcon>
		</Group>
	);
}

// ── Item Editor ──
function ItemEditor({ item, onChange, onDelete }: { item: RubricItem; onChange: (i: RubricItem) => void; onDelete: () => void }) {
	return (
		<Box py="sm">
			<Group gap={8} align="center" mb={8} wrap="nowrap">
				<Input value={item.name} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...item, name: e.target.value })} size="sm" style={{ flex: 1 }} placeholder="子项名称" />
				<ActionIcon variant="subtle" color="gray" onClick={onDelete} aria-label="删除子项">
					<IconTrash size={14} />
				</ActionIcon>
			</Group>
			<Stack gap={6} ml={4}>
				{item.anchors.map((anchor, ai) => (
					<AnchorRow key={ai} anchor={anchor}
						onChange={(updated) => { const anchors = [...item.anchors]; anchors[ai] = updated; onChange({ ...item, anchors }); }}
						onDelete={() => onChange({ ...item, anchors: item.anchors.filter((_, i) => i !== ai) })} />
				))}
				<Button
					variant="transparent"
					size="xs"
					onClick={() => {
						const maxScore = item.anchors.length > 0 ? Math.max(...item.anchors.map((a) => a.score)) + 1 : 0;
						onChange({ ...item, anchors: [...item.anchors, { score: maxScore, description: "" }] });
					}}
					leftSection={<IconPlus size={12} />}
					style={{ alignSelf: "flex-start" }}
				>
					添加锚点
				</Button>
			</Stack>
		</Box>
	);
}

// ── Dimension Editor ──
function DimensionEditor({ dim, onChange, onDelete }: { dim: RubricDimension; onChange: (d: RubricDimension) => void; onDelete: () => void }) {
	return (
		<Card>
			<CardHeader>
				<Group gap={8} align="center" wrap="nowrap">
					<Input value={dim.name} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...dim, name: e.target.value })} size="sm" style={{ flex: 1 }} placeholder="维度名称" />
					<Group gap={4} align="center" wrap="nowrap">
						<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>满分</Text>
						<Input type="number" value={dim.max} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...dim, max: Number(e.target.value) })} size="xs" w={64} min={0} />
						<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>分</Text>
					</Group>
					<ActionIcon variant="subtle" color="gray" onClick={onDelete} aria-label="删除维度">
						<IconTrash size={16} />
					</ActionIcon>
				</Group>
			</CardHeader>
			<CardContent>
				<Input value={dim.description || ""} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...dim, description: e.target.value || undefined })} size="xs" mb="sm" placeholder="维度描述（可选）" />
				<Stack gap={0}>
					{dim.items.map((item, ii) => (
						<Box key={item.id}>
							{ii > 0 && <Divider />}
							<ItemEditor key={item.id} item={item}
								onChange={(updated) => { const items = [...dim.items]; items[ii] = updated; onChange({ ...dim, items }); }}
								onDelete={() => onChange({ ...dim, items: dim.items.filter((_, i) => i !== ii) })} />
						</Box>
					))}
				</Stack>
				<Button
					variant="transparent"
					size="sm"
					onClick={() => {
						const newId = `item_${Date.now()}`;
						onChange({ ...dim, items: [...dim.items, { id: newId, name: "", anchors: [{ score: 0, description: "" }] }] });
					}}
					leftSection={<IconPlus size={14} />}
					mt="sm"
				>
					添加子项
				</Button>
			</CardContent>
		</Card>
	);
}

// ── Read-Only Viewer ──
function RubricViewer({ rubric }: { rubric: RubricData }) {
	return (
		<>
			{rubric.dimensions.map((dim) => (
				<Card key={dim.id}>
					<CardHeader style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
						<CardTitle>{dim.name}</CardTitle>
						<Text size="xs" c="dimmed" mt={2}>满分 {dim.max} 分{dim.description ? ` · ${dim.description}` : ""}</Text>
					</CardHeader>
					<CardContent>
						<Stack gap={0}>
							{dim.items.map((item) => (
								<Box key={item.id} py="md">
									<Text size="sm" fw={500}>{item.name}</Text>
									<Stack gap={4} mt={8}>
										{item.anchors.map((a, i) => (
											<Group key={i} gap={12} align="flex-start" wrap="nowrap">
												<Text ff="monospace" fw={700} c="teal" w={24} style={{ flexShrink: 0 }}>{a.score}分</Text>
												<Text size="sm" c="dimmed">{a.description}</Text>
											</Group>
										))}
									</Stack>
								</Box>
							))}
						</Stack>
					</CardContent>
				</Card>
			))}
		</>
	);
}

// ── Page ──
export default function RubricPage() {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<RubricData | null>(null);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.rubric.current(),
		queryFn: () => api.get("/rubrics/current" satisfies ApiPath as string).then((r) => r.data),
		staleTime: 30 * 60_000,
	});

	const startEditing = useCallback(() => {
		if (data) { setDraft(rawToDraft(data as RubricDataRaw)); setEditing(true); }
	}, [data]);

	const cancelEditing = () => { setDraft(null); setEditing(false); };

	const raw = data as RubricDataRaw | undefined;
	const displayData: RubricData | undefined = editing && draft ? draft : raw ? rawToDraft(raw) : undefined;

	if (isLoading) return <LoadingSkeleton variant="card" />;
	if (!displayData) return <Text ta="center" py={32} c="dimmed">加载失败</Text>;

	return (
		<Stack gap="xl">
			<PageHeader
				title="评分标准"
				subtitle={editing ? "编辑模式 - 完成后导出 JSON 部署到服务器" : `${displayData.name} · v${displayData.version} · 满分 ${displayData.total_max} 分`}
				icon={IconBook2}
				actions={
					<Group gap={8}>
						{editing ? (
							<>
								<Button variant="outline" size="sm" onClick={cancelEditing} leftSection={<IconX size={14} />}>取消</Button>
								<Button size="sm" onClick={() => draft && downloadJson(draftToExport(draft), `rubric_${draft.version}.json`)} leftSection={<IconDownload size={14} />}>导出 JSON</Button>
							</>
						) : (
							<Button variant="outline" size="sm" onClick={startEditing} leftSection={<IconEdit size={14} />}>编辑</Button>
						)}
					</Group>
				}
			/>

			{editing ? (
				<>
					<Group gap={8} align="center" wrap="nowrap">
						<Input value={draft?.name ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => draft && setDraft({ ...draft, name: e.target.value })} size="md" w={256} placeholder="评分标准名称" />
						<Text size="xs" c="dimmed">v{draft?.version ?? ""}</Text>
					</Group>
					{draft?.dimensions.map((dim, di) => (
						<DimensionEditor key={dim.id} dim={dim}
							onChange={(updated) => { if (!draft) return; const dims = [...draft.dimensions]; dims[di] = updated; setDraft({ ...draft, dimensions: dims }); }}
							onDelete={() => { if (!draft) return; setDraft({ ...draft, dimensions: draft.dimensions.filter((_, i) => i !== di) }); }} />
					))}
					<Button variant="outline" onClick={() => {
						if (!draft) return;
						const newId = `dim_${Date.now()}`;
						setDraft({ ...draft, dimensions: [...draft.dimensions, { id: newId, name: "", max: 10, items: [] }] });
					}} leftSection={<IconPlus size={14} />}>添加评分维度</Button>
				</>
			) : (
				<RubricViewer rubric={displayData} />
			)}
		</Stack>
	);
}
