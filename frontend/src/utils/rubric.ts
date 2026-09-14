/**
 * 评分标准（rubric）的草稿/导出转换 —— 与页面解耦的纯函数，便于回归测试。
 *
 * `raw` = 后端 `/rubrics/current` 返回的形态（锚点为 score → description 映射）；
 * `draft` = 编辑器工作形态（锚点为有序数组）。两者必须逐字段可逆：导出会直接
 * 覆盖部署的 rubric.json，任何写死字段（历史上曾写死 scale/raw_max/raw_scale）
 * 都会改变全库评分的归一化分母。
 */

export interface RubricAnchor { score: number; description: string; }
export interface RubricItem { id: string; name: string; anchors: RubricAnchor[]; }
export interface RubricDimension { id: string; name: string; max: number; description?: string; items: RubricItem[]; }

export interface RubricData {
	id: string; name: string; version: string; total_max: number;
	scale: number; raw_max: number; raw_scale: number;
	dimensions: RubricDimension[];
}

export interface RubricItemRaw { id: string; name: string; anchors: Record<string, string>; }

export interface RubricDataRaw {
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

export function rawToDraft(raw: RubricDataRaw): RubricData {
	return {
		id: raw.id, name: raw.name, version: raw.version, total_max: raw.total_max,
		scale: raw.scale, raw_max: raw.raw_max, raw_scale: raw.raw_scale,
		dimensions: raw.dimensions.map((d) => ({
			id: d.id, name: d.name, max: d.max, description: d.description,
			items: d.items.map((i) => ({ id: i.id, name: i.name, anchors: anchorsToArray(i.anchors) })),
		})),
	};
}

export function draftToExport(draft: RubricData): RubricDataRaw {
	return {
		id: draft.id, name: draft.name, version: draft.version,
		total_max: draft.total_max, scale: draft.scale, raw_max: draft.raw_max, raw_scale: draft.raw_scale,
		dimensions: draft.dimensions.map((d) => ({
			id: d.id, name: d.name, max: d.max, description: d.description,
			items: d.items.map((i) => ({ id: i.id, name: i.name, anchors: anchorsToRecord(i.anchors) })),
		})),
	};
}
