import type {
	ScenarioBoard,
	ScenarioBoardEntry,
	ScenarioImage,
	ScenarioMessage,
	ScenarioOption,
	ScenarioView,
} from "@/api/scenario";

/**
 * 流式回合的**草稿合并**（纯函数，唯一的读法）。
 *
 * 后端的块是"顶层字段写完即推"：`narration` / `lines` / `options` / `images` / `notes`。
 * 这里只做一件事：把这些块**叠加到当前视图之上**让界面先长出来；权威 `view` 一到，
 * 调用方把草稿丢掉、整体换成它（草稿永远不是真相）。
 *
 * 字段映射与后端 `runtime/view.py` 的投影**逐键对应**（同一份契约，两处镜像）：
 * - 台词：`as_role` → `actor_role`、`avatar_seed = as_role || actor`；
 * - 选项：`label/type/affordance_id/params`；
 * - 图片：`asset_id` 去当前视图的 `assets` 里取 url（DM 只能引用 pack 声明过的图）；
 * - 板上的判断：`text/supersedes` → note 版块条目。
 */

export interface ScenarioStreamDraft {
	narration?: string;
	lines?: unknown[];
	options?: unknown[];
	images?: unknown[];
	notes?: unknown[];
}

/**
 * 待定（乐观）学生条目：学生刚提交、权威 `view` 还没到的那一句。
 *
 * 它**不是**会话状态的一部分：只活在"`view` 未到"的窗口里，`view` 一到就整体退场
 * （对话流以 `view.messages` 为准重绘），所以它永远不会跟正式消息同时出现。
 */
export interface PendingStudentLine {
	/**
	 * 与后端口径一致的那一句：`action.text or 可读标签`（取法见 `ScenarioConsole.submit`，
	 * 与 `runtime/view.py` 的 `_messages` 逐字对应）。两边同口径，接管时才是同一句。
	 */
	text: string;
	/** 预期回合号（`view.session.turn + 1`）："同回合 + 同文案"去重判据用的就是它。 */
	turn: number;
}

/**
 * 权威视图里是否已经有这条待定条目的正式身（**同回合 + 同文案**）——防重复的判据。
 *
 * 命中 = 正式消息已经顶上来了，待定的那条立即不渲染。
 * 没命中也不留幽灵：`view` 到达时调用方整体清掉待定条目（以 `view.messages` 为准重绘）。
 */
export function hasStudentLine(
	view: ScenarioView,
	line: PendingStudentLine,
): boolean {
	return view.messages.some(
		(message) =>
			message.role === "student" &&
			message.turn === line.turn &&
			message.text === line.text,
	);
}

/** 同一个 key 再次出现 = 更新（后端只推变化，但允许修正）。 */
export function mergeBlocks(
	draft: ScenarioStreamDraft,
	blocks: Record<string, unknown>,
): ScenarioStreamDraft {
	const next: ScenarioStreamDraft = { ...draft };
	for (const key of Object.keys(blocks)) {
		const value = blocks[key];
		if (value === null || value === undefined) continue;
		if (key === "narration" && typeof value === "string") next.narration = value;
		else if (key === "lines" && Array.isArray(value)) next.lines = value;
		else if (key === "options" && Array.isArray(value)) next.options = value;
		else if (key === "images" && Array.isArray(value)) next.images = value;
		else if (key === "notes" && Array.isArray(value)) next.notes = value;
	}
	return next;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function toLineMessage(raw: unknown): ScenarioMessage | null {
	const line = asRecord(raw);
	const text = str(line.text);
	if (!text) return null;
	const actor = str(line.actor);
	const asRole = str(line.as_role);
	return {
		role: "actor",
		actor: actor || null,
		actor_role: asRole || null,
		ephemeral: line.ephemeral === true,
		avatar_seed: asRole || actor,
		text,
		origin: line.origin === "entity" ? "entity" : "dm",
	};
}

function toOption(raw: unknown): ScenarioOption | null {
	const option = asRecord(raw);
	const label = str(option.label);
	if (!label) return null;
	return {
		label,
		type: str(option.type) || "ask",
		affordance_id: str(option.affordance_id) || null,
		params: asRecord(option.params),
		free_input: true,
	};
}

function toImage(raw: unknown, assets: ScenarioImage[]): ScenarioImage | null {
	const image = asRecord(raw);
	const assetId = str(image.asset_id);
	if (!assetId) return null;
	const known = assets.find((asset) => asset.asset_id === assetId);
	return {
		asset_id: assetId,
		url: known?.url ?? "",
		title: str(image.title) || known?.title || "",
		alt: str(image.alt) || known?.alt || "",
		caption: str(image.caption),
		origin: str(image.origin) || "pack",
	};
}

function toNoteEntry(raw: unknown, index: number): ScenarioBoardEntry | null {
	const note = asRecord(raw);
	const text = str(note.text);
	if (!text) return null;
	return {
		id: str(note.id) || `draft-note:${index}`,
		kind: "note",
		text,
		source: "dm",
		supersedes: str(note.supersedes) || undefined,
	};
}

/** 把草稿里的判断挂进板上的 note 版块（没有该版块就不凭空造版块）。 */
function withDraftNotes(board: ScenarioBoard, notes: unknown[]): ScenarioBoard {
	const entries = notes
		.map((note, index) => toNoteEntry(note, index))
		.filter((entry): entry is ScenarioBoardEntry => entry !== null);
	if (entries.length === 0) return board;
	const target = board.sections.findIndex((section) => section.source === "note");
	if (target === -1) return board;
	const sections = board.sections.map((section, index) =>
		index === target
			? { ...section, entries: [...section.entries, ...entries] }
			: section,
	);
	return { ...board, sections, entry_count: board.entry_count + entries.length };
}

/**
 * 当前视图 + 草稿 + **待定学生条目** → 用于渲染的视图。
 *
 * **不改变会话状态**：只在展示层追加"已经写完的块"与"还没落地的学生条目"。
 * 待定条目排在这一回合**最前**——回合内顺序是 学生 → 旁白 → 台词（他先做，世界才回应，
 * 与后端 `_messages` 的排序同口径）。`view` 到达时草稿与待定条目一起由调用方丢掉。
 */
export function draftView(
	view: ScenarioView,
	draft: ScenarioStreamDraft | null,
	pending: PendingStudentLine | null = null,
): ScenarioView {
	const merged = draft ?? {};
	const added: ScenarioMessage[] = [];
	if (merged.narration) {
		added.push({ role: "scene", text: merged.narration });
	}
	for (const raw of merged.lines ?? []) {
		const message = toLineMessage(raw);
		if (message) added.push(message);
	}

	const assets = view.images ?? [];
	// 待定条目的回合号是**预测**的（`view.session.turn + 1`，与后端 `world.turn + 1` 同口径）：
	// 猜对了，正式消息接管时连 DOM 节点都不用换；猜错了也只是回到"以 view.messages 为准"。
	const lead: ScenarioMessage[] = pending
		? [{ role: "student", text: pending.text, turn: pending.turn, pending: true }]
		: [];
	const images = (merged.images ?? [])
		.map((raw) => toImage(raw, assets))
		.filter((image): image is ScenarioImage => image !== null);
	const options = (merged.options ?? [])
		.map(toOption)
		.filter((option): option is ScenarioOption => option !== null);
	const board = view.board;

	return {
		...view,
		messages:
			lead.length + added.length > 0
				? [...view.messages, ...lead, ...added]
				: view.messages,
		options: merged.options ? options : view.options,
		images: images.length > 0 ? [...assets, ...images] : view.images,
		board:
			board && merged.notes ? withDraftNotes(board, merged.notes) : view.board,
	};
}
