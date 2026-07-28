import { useQuery } from "@tanstack/react-query";
import { BookOpen, Download, Edit3, Plus, Trash2, X } from "lucide-react";
import { useState, useCallback, type ChangeEvent } from "react";
import type { ApiPath } from "@/api/api-path";
import { api } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import Button from "@/components/ui/button";
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
		<div className="flex items-center gap-2 text-sm">
			<Input type="number" value={anchor.score} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...anchor, score: Number(e.target.value) })} className="w-16 h-8 text-xs" min={0} />
			<span className="text-xs text-muted-foreground shrink-0">分 —</span>
			<Input value={anchor.description} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...anchor, description: e.target.value })} className="flex-1 h-8 text-xs" placeholder="锚点描述…" />
			<button onClick={onDelete} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" aria-label="删除锚点"><Trash2 size={14} /></button>
		</div>
	);
}

// ── Item Editor ──
function ItemEditor({ item, onChange, onDelete }: { item: RubricItem; onChange: (i: RubricItem) => void; onDelete: () => void }) {
	return (
		<div className="py-3 first:pt-0 last:pb-0 border-b last:border-0">
			<div className="flex items-center gap-2 mb-2">
				<Input value={item.name} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...item, name: e.target.value })} className="flex-1 h-8 text-sm font-medium" placeholder="子项名称" />
				<button onClick={onDelete} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" aria-label="删除子项"><Trash2 size={14} /></button>
			</div>
			<div className="space-y-1.5 ml-1">
				{item.anchors.map((anchor, ai) => (
					<AnchorRow key={ai} anchor={anchor}
						onChange={(updated) => { const anchors = [...item.anchors]; anchors[ai] = updated; onChange({ ...item, anchors }); }}
						onDelete={() => onChange({ ...item, anchors: item.anchors.filter((_, i) => i !== ai) })} />
				))}
				<button onClick={() => {
					const maxScore = item.anchors.length > 0 ? Math.max(...item.anchors.map((a) => a.score)) + 1 : 0;
					onChange({ ...item, anchors: [...item.anchors, { score: maxScore, description: "" }] });
				}} className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"><Plus size={12} /> 添加锚点</button>
			</div>
		</div>
	);
}

// ── Dimension Editor ──
function DimensionEditor({ dim, onChange, onDelete }: { dim: RubricDimension; onChange: (d: RubricDimension) => void; onDelete: () => void }) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center gap-2 pb-2">
				<div className="flex-1 flex items-center gap-2">
					<Input value={dim.name} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...dim, name: e.target.value })} className="flex-1 h-8 text-base font-semibold" placeholder="维度名称" />
					<span className="text-xs text-muted-foreground shrink-0">满分 <Input type="number" value={dim.max} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...dim, max: Number(e.target.value) })} className="inline w-16 h-7 text-xs mx-1" min={0} /> 分</span>
				</div>
				<button onClick={onDelete} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" aria-label="删除维度"><Trash2 size={16} /></button>
			</CardHeader>
			<CardContent>
				<Input value={dim.description || ""} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...dim, description: e.target.value || undefined })} className="h-8 text-xs mb-3" placeholder="维度描述（可选）" />
				<div className="divide-y">
					{dim.items.map((item, ii) => (
						<ItemEditor key={item.id} item={item}
							onChange={(updated) => { const items = [...dim.items]; items[ii] = updated; onChange({ ...dim, items }); }}
							onDelete={() => onChange({ ...dim, items: dim.items.filter((_, i) => i !== ii) })} />
					))}
				</div>
				<button onClick={() => {
					const newId = `item_${Date.now()}`;
					onChange({ ...dim, items: [...dim.items, { id: newId, name: "", anchors: [{ score: 0, description: "" }] }] });
				}} className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-3"><Plus size={14} /> 添加子项</button>
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
					<CardHeader className="border-b"><CardTitle>{dim.name}</CardTitle>
						<p className="text-xs text-muted-foreground mt-0.5">满分 {dim.max} 分{dim.description ? ` · ${dim.description}` : ""}</p>
					</CardHeader>
					<CardContent className="pt-4"><div className="divide-y">
						{dim.items.map((item) => (
							<div key={item.id} className="py-4 first:pt-0 last:pb-0">
								<p className="text-sm font-medium">{item.name}</p>
								<div className="mt-2 space-y-1">
									{item.anchors.map((a, i) => (
										<div key={i} className="flex items-start gap-3 text-sm">
											<span className="font-mono font-bold text-primary shrink-0 w-6">{a.score}分</span>
											<span className="text-muted-foreground">{a.description}</span>
										</div>
									))}
								</div>
							</div>
						))}
					</div></CardContent>
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
	if (!displayData) return <div className="p-8 text-center text-muted-foreground">加载失败</div>;

	return (
		<div className="space-y-6">
			<PageHeader
				title="评分标准"
				subtitle={editing ? "编辑模式 — 完成后导出 JSON 部署到服务器" : `${displayData.name} · v${displayData.version} · 满分 ${displayData.total_max} 分`}
				icon={BookOpen}
				actions={
					<div className="flex items-center gap-2">
						{editing ? (
							<>
								<Button variant="outline" size="sm" onClick={cancelEditing}><X size={14} /> 取消</Button>
								<Button size="sm" onClick={() => draft && downloadJson(draftToExport(draft), `rubric_${draft.version}.json`)}><Download size={14} /> 导出 JSON</Button>
							</>
						) : (
							<Button variant="outline" size="sm" onClick={startEditing}><Edit3 size={14} /> 编辑</Button>
						)}
					</div>
				}
			/>

			{editing ? (
				<>
					<div className="flex items-center gap-2">
						<Input value={draft?.name ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => draft && setDraft({ ...draft, name: e.target.value })} className="h-9 text-lg font-semibold w-64" placeholder="评分标准名称" />
						<span className="text-xs text-muted-foreground">v{draft?.version ?? ""}</span>
					</div>
					{draft?.dimensions.map((dim, di) => (
						<DimensionEditor key={dim.id} dim={dim}
							onChange={(updated) => { if (!draft) return; const dims = [...draft.dimensions]; dims[di] = updated; setDraft({ ...draft, dimensions: dims }); }}
							onDelete={() => { if (!draft) return; setDraft({ ...draft, dimensions: draft.dimensions.filter((_, i) => i !== di) }); }} />
					))}
					<Button variant="outline" onClick={() => {
						if (!draft) return;
						const newId = `dim_${Date.now()}`;
						setDraft({ ...draft, dimensions: [...draft.dimensions, { id: newId, name: "", max: 10, items: [] }] });
					}} className="w-full"><Plus size={14} /> 添加评分维度</Button>
				</>
			) : (
				<RubricViewer rubric={displayData} />
			)}
		</div>
	);
}
