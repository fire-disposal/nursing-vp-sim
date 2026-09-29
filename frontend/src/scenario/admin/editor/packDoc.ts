/**
 * 场景编辑器的**文档层**：pack 内容的读写、原始文本互转、改动摘要。
 *
 * 这里只有纯函数（没有 React、没有请求），所以双向同步与"哪些字段会变"这两件事
 * 都能直接单测——界面只负责把它们接起来。
 *
 * 三条约定：
 * - 内容是一棵普通 JSON 树（`ScenarioPackDoc`），形状由**后端**校验；前端不复刻校验器。
 * - 「JSON 原始」页签里的文本就是 `JSON.stringify(content, null, 2)`：
 *   互转无损（含 `null`——模型把"缺省"与显式 `null` 视为同一件事，所以不必也不该改写它）。
 * - 任何写操作都返回**新对象**（不可变），React 的脏检查与改动摘要都靠它。
 */

import type { ScenarioPackDoc, ScenarioPackValue } from "@/api/scenario";

/** 内容 → 原始文本（**唯一**的写法：两空格缩进，便于人读与 diff）。 */
export function toJsonText(doc: ScenarioPackDoc): string {
	return JSON.stringify(doc, null, 2);
}

/**
 * 原始文本 → 内容。
 *
 * 只接受**一张表**（与后端契约一致：pack 顶层是对象）：数组/标量一律报错，
 * 免得作者把半截数组粘进来、表单却静默变成空。
 */
export function fromJsonText(text: string): ScenarioPackDoc {
	const parsed: unknown = JSON.parse(text);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("顶层必须是一个对象（JSON 里用 { } 包起来）");
	}
	return parsed as ScenarioPackDoc;
}

/**
 * 后端返回的内容（`{[key: string]: unknown}`）是不是编辑器能读的内容。
 *
 * 判据只到**顶层**（与 `fromJsonText` 一致）：必须是一张表；缺省/数组/标量一律 `false`，
 * 调用方据此显示"没有可编辑的内容"，而不是把 `undefined` 塞进表单状态再到处判空。
 * 深层的字段形状由**后端**那同一套校验负责，前端不复刻。
 */
export function isPackDocShaped(value: unknown): value is ScenarioPackDoc {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 把解析失败翻成一句可读的中文（尽量带行号；`JSON.parse` 的原文折在最后）。 */
export function describeJsonError(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	const located = raw.match(/line (\d+) column (\d+)/);
	if (located) return `第 ${located[1]} 行第 ${located[2]} 列：${raw}`;
	const position = raw.match(/position (\d+)/);
	return position ? `第 ${position[1]} 个字符处：${raw}` : raw;
}

type Key = string | number;
type Node = ScenarioPackValue;

/** 不可变深写：`setIn(doc, ["setting","place"], "…")`。中间层缺失时按路径类型补空容器。 */
export function setIn<T extends Node>(root: T, path: Key[], value: Node): T {
	if (path.length === 0) return value as T;
	const [head, ...rest] = path;
	if (Array.isArray(root)) {
		const next = [...root];
		next[head as number] = rest.length === 0 ? value : setIn(next[head as number], rest, value);
		return next as unknown as T;
	}
	const source = (root ?? {}) as Record<string, Node>;
	const current = source[head] ?? (typeof rest[0] === "number" ? [] : {});
	return { ...source, [head]: rest.length === 0 ? value : setIn(current, rest, value) } as unknown as T;
}

/** 不可变列表操作（列表字段的增删排序都走它）。 */
export function moveIn<T>(list: readonly T[], from: number, to: number): T[] {
	if (to < 0 || to >= list.length) return [...list];
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
	return list.filter((_, position) => position !== index);
}

export function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
	const next = [...list];
	next.splice(index, 0, item);
	return next;
}

/** 把两条路径拼成一条（跳过空段），例如 `["setting","cues"]` + `1` + `"text"`。 */
function joinPath(parts: Key[]): string {
	return parts
		.map((part) => (typeof part === "number" ? `[${part}]` : part))
		.join(".")
		.replace(/\.\[/g, "[");
}

/**
 * 改动摘要：列出**叶子级**改动路径（新增/删除的整棵子树只报它自己）。
 *
 * 保存前的确认对话框用它告诉作者"这次会改哪些字段"——作者据此判断自己改的是不是想改的那处。
 */
export function diffPaths(before: Node | undefined, after: Node | undefined, base: Key[] = []): string[] {
	if (before === after) return [];
	if (Array.isArray(before) && Array.isArray(after)) {
		const out: string[] = [];
		const length = Math.max(before.length, after.length);
		for (let index = 0; index < length; index += 1) {
			if (index >= before.length || index >= after.length) {
				out.push(joinPath([...base, index]));
				continue;
			}
			out.push(...diffPaths(before[index], after[index], [...base, index]));
		}
		return out;
	}
	if (isTable(before) && isTable(after)) {
		const out: string[] = [];
		for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
			if (!(key in before) || !(key in after)) out.push(joinPath([...base, key]));
			else out.push(...diffPaths(before[key], after[key], [...base, key]));
		}
		return out;
	}
	return [joinPath(base)];
}

function isTable(value: Node | undefined): value is Record<string, ScenarioPackValue> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 从内容里安全取出一张子表（缺失/类型不符 → 空表）。 */
export function tableAt(doc: ScenarioPackDoc, key: string): Record<string, ScenarioPackValue> {
	const value = doc[key];
	return isTable(value) ? value : {};
}

/** 从内容里安全取出一个列表（缺失/类型不符 → 空列表）。 */
export function listAt<T>(doc: ScenarioPackDoc, ...path: Key[]): T[] {
	let current: Node | undefined = doc;
	for (const key of path) {
		if (current === null || typeof current !== "object") return [];
		current = Array.isArray(current) ? current[key as number] : (current as Record<string, Node>)[key];
	}
	return Array.isArray(current) ? (current as T[]) : [];
}

/** 从内容里取字符串（缺失/类型不符 → 空串），表单里大多数字段都是它。 */
export function textAt(doc: ScenarioPackDoc, ...path: Key[]): string {
	let current: Node | undefined = doc;
	for (const key of path) {
		if (current === null || typeof current !== "object") return "";
		current = Array.isArray(current) ? current[key as number] : (current as Record<string, Node>)[key];
	}
	return typeof current === "string" ? current : "";
}

/** 从内容里取布尔（缺失/类型不符 → `false`）。 */
export function boolAt(doc: ScenarioPackDoc, ...path: Key[]): boolean {
	let current: Node | undefined = doc;
	for (const key of path) {
		if (current === null || typeof current !== "object") return false;
		current = Array.isArray(current) ? current[key as number] : (current as Record<string, Node>)[key];
	}
	return current === true;
}

/** 从内容里取数字（缺失/类型不符 → `fallback`）。 */
export function numberAt(doc: ScenarioPackDoc, path: Key[], fallback: number): number {
	let current: Node | undefined = doc;
	for (const key of path) {
		if (current === null || typeof current !== "object") return fallback;
		current = Array.isArray(current) ? current[key as number] : (current as Record<string, Node>)[key];
	}
	return typeof current === "number" ? current : fallback;
}
