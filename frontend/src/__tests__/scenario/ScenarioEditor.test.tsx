/**
 * 场景编辑器组件：两个页签的**双向同步**、保存前的**字段级定位**与**确认摘要**、
 * 历史形状修订的**只读 + 显式转换**，以及**保存并试跑**这条出口。
 *
 * 这里钉的是行为，不是实现：
 * - 默认落在「表单」，表单改动让「JSON 原始」文本跟着变；
 * - 原始文本改动解析成功后表单跟着变；解析失败**保留文本**且**不清空表单**；
 * - 校验失败时按节给出跳转入口，认不出节的问题连字段路径一起列出；保存按钮背后一定先过校验；
 * - 保存**一律追加新修订**（内容没变就是复用，`created=false`）；
 * - **保存并试跑**：先追加修订，再用**这次刚保存的修订**开一局 `trial` 会话，跳到学生侧控制台；
 * - 形状不是当前形状的修订（`compatible=false` / `legacy=true`）**只读**：原样给出 JSON、没有保存控件，
 *   要编辑必须走**显式转换**，转换结果是一份**未保存的草稿**（保存才会成为新修订）。
 *
 * 组件在 Router 里（`useNavigate` 是那条试跑出口的一部分）：这里用 `MemoryRouter` + 一个位置探针，
 * 断言的是"跳到哪了"，不是"调没调 hook"。
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type { ScenarioAdminPack, ScenarioAdminPackSource } from "@/api/scenario";
import AdminCaseEditorPanel from "@/scenario/admin/AdminCaseEditorPanel";

const mocks = vi.hoisted(() => ({
	getSource: vi.fn(),
	validate: vi.fn(),
	save: vi.fn(),
	convert: vi.fn(),
	createSession: vi.fn(),
	confirm: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return {
		...actual,
		getAdminScenarioPackSource: mocks.getSource,
		validateAdminScenarioPack: mocks.validate,
		saveAdminScenarioPackRevision: mocks.save,
		convertAdminScenarioPack: mocks.convert,
		createScenarioSession: mocks.createSession,
	};
});

vi.mock("@/components/ui/confirm", () => ({
	useConfirm: () => ({ confirm: mocks.confirm }),
}));

vi.mock("@/components/Toast", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

// Monaco 在 jsdom 里没有运行时：用可读的替身，让"文本 → 表单"这条链仍能被断言，
// 并把 `options.readOnly` 透出来（只读与否也是一条要钉的行为）。
vi.mock("@monaco-editor/react", () => ({
	default: ({
		value,
		onChange,
		options,
	}: {
		value?: string;
		onChange?: (v: string) => void;
		options?: { readOnly?: boolean };
	}) => (
		<textarea
			data-testid="json-editor"
			data-readonly={String(options?.readOnly === true)}
			value={value ?? ""}
			onChange={(event) => onChange?.(event.currentTarget.value)}
		/>
	),
}));

const PACK_KEY = "sputum-ineffective";

const PACK = {
	key: PACK_KEY,
	title: "吸痰无效：血氧上不来",
	state: "experimental",
	one_line: "夜班，痰多却吸不出来。",
	revision_id: 8,
	revision_no: 3,
	revisions: [
		{ id: 8, no: 3, note: "cli install" },
		{ id: 7, no: 2, note: "旧修订" },
	],
	assets: [],
	overview: null,
	sessions: 0,
} as unknown as ScenarioAdminPack;

/** 当前形状（v3）的一份内容。 */
const CONTENT = {
	pack_schema_version: 3,
	key: PACK_KEY,
	title: PACK.title,
	one_line: PACK.one_line,
	player: { role: "夜班护士" },
	setting: { place: "呼吸内科病房", cues: [{ id: "c1", text: "患者坐起前倾。" }] },
	actors: [{ id: "patient", role: "患者", presence: "on_site" }],
	affordances: [{ id: "suction", type: "act", label: "吸痰" }],
	facts: [],
	rubric: [],
	presentation: {},
};

/** 切换前形状（v1）的一份内容：带着今天的 schema 认不出的字段。 */
const LEGACY_CONTENT = {
	pack_schema_version: 1,
	key: PACK_KEY,
	title: PACK.title,
	anchors: [{ id: "a_start", stage: "airway", goal: "先测量与听诊", deadline_turns: 2 }],
};

/** 显式转换的产物：已经是当前形状，但**还没有成为修订**。 */
const CONVERTED_CONTENT = {
	...CONTENT,
	title: "转换后的标题",
	teaching_focus: [{ id: "tf_start", intent: "先测量与听诊" }],
};

function source(overrides: Partial<ScenarioAdminPackSource> = {}): ScenarioAdminPackSource {
	return {
		key: PACK_KEY,
		title: PACK.title,
		state: "experimental",
		revision_id: 8,
		revision_no: 3,
		note: "cli install",
		content: CONTENT,
		problems: [],
		revisions: PACK.revisions,
		schema_version: 3,
		current_schema_version: 3,
		compatible: true,
		legacy: false,
		...overrides,
	};
}

/** 一份**历史形状**的修订：只读，要编辑必须先显式转换。 */
function legacySource(overrides: Partial<ScenarioAdminPackSource> = {}): ScenarioAdminPackSource {
	return source({
		revision_id: 7,
		revision_no: 2,
		note: "旧修订",
		content: LEGACY_CONTENT,
		problems: [
			{
				path: "anchors",
				message: "锚点任务状态机已移除（迁移路径会把它折进 teaching_focus）",
			},
		],
		schema_version: 1,
		current_schema_version: 3,
		compatible: false,
		legacy: true,
		...overrides,
	});
}

function converted(overrides: Record<string, unknown> = {}) {
	return {
		content: CONVERTED_CONTENT,
		notes: ["anchors → teaching_focus（1 条）"],
		problems: [],
		from_schema_version: 1,
		to_schema_version: 3,
		...overrides,
	};
}

/** 位置探针：试跑出口的断言落在"跳到哪了"上。 */
function LocationProbe() {
	const location = useLocation();
	return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPanel() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/scenario-admin"]}>
				<LocationProbe />
				<AdminCaseEditorPanel pack={PACK} />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** 改一处表单文案（标题），用于制造"有改动"的状态。 */
async function editTitle(user: UserEvent, value: string) {
	const input = await screen.findByLabelText("标题");
	await user.clear(input);
	await user.type(input, value);
}

const saveButton = () => screen.getByRole("button", { name: /保存（追加新修订）/ });
const trialButton = () => screen.getByRole("button", { name: "保存并试跑" });

beforeEach(() => {
	mocks.getSource.mockResolvedValue(source());
	mocks.validate.mockResolvedValue({
		ok: true,
		problems: [],
		content_sha: "deadbeef",
		latest_sha: "cafebabe",
		will_append: true,
		next_revision_no: 4,
		pack_schema_version: 3,
	});
	mocks.save.mockResolvedValue({
		key: PACK_KEY,
		revision_id: 9,
		revision_no: 4,
		created: true,
		assets_pending: [],
	});
	mocks.createSession.mockResolvedValue({ session_id: 77 });
	mocks.confirm.mockResolvedValue(true);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("场景编辑器：载入与两个页签", () => {
	it("默认落在表单，且是从最新修订载入的内容", async () => {
		renderPanel();
		expect(await screen.findByLabelText("标题")).toHaveValue(PACK.title);
		expect(screen.getByLabelText("一句话")).toHaveValue(PACK.one_line);
		expect(screen.getByLabelText("玩家角色")).toHaveValue("夜班护士");
		expect(mocks.getSource).toHaveBeenCalledWith(PACK_KEY, undefined);
	});

	it("表单改动会同步到「JSON 原始」文本", async () => {
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(screen.getByRole("tab", { name: "JSON 原始" }));
		const editor = (await screen.findByTestId("json-editor")) as HTMLTextAreaElement;
		expect(editor).toHaveAttribute("data-readonly", "false");
		expect(editor.value).toContain('"title": "改过的标题"');
	});

	it("原始文本改动解析成功后表单跟着变；解析失败时保留文本且不清空表单", async () => {
		const user = userEvent.setup();
		renderPanel();
		await screen.findByLabelText("标题");
		await user.click(screen.getByRole("tab", { name: "JSON 原始" }));

		const editor = await screen.findByTestId("json-editor");
		await user.clear(editor);
		await user.type(editor, '{{"title": "从原始文本改的"}');
		await user.click(screen.getByRole("tab", { name: "表单" }));
		// 防抖解析落地后才写回表单：这里等的是"表单变了"，不是"报错消失了"
		await waitFor(() => expect(screen.getByLabelText("标题")).toHaveValue("从原始文本改的"));
		expect(screen.queryByText(/JSON 解析失败/)).toBeNull();

		// 半截 JSON：只报错、保留文本，表单仍是上一次能解析的版本
		await user.click(screen.getByRole("tab", { name: "JSON 原始" }));
		const broken = await screen.findByTestId("json-editor");
		await user.clear(broken);
		await user.type(broken, '{{"title": "没关引号');
		expect(await screen.findByText(/JSON 解析失败/, {}, { timeout: 2000 })).toBeInTheDocument();
		expect(screen.getByTestId("json-editor")).toHaveValue('{"title": "没关引号');
		await user.click(screen.getByRole("tab", { name: "表单" }));
		expect(screen.getByLabelText("标题")).toHaveValue("从原始文本改的");
	});

	it("可以切到历史修订载入", async () => {
		const user = userEvent.setup();
		mocks.getSource.mockImplementation((_key: string, revisionId?: number) =>
			Promise.resolve(
				revisionId === 7
					? source({ revision_id: 7, revision_no: 2, note: "旧修订" })
					: source(),
			),
		);
		renderPanel();
		await screen.findByLabelText("标题");
		const picker = screen.getByRole("combobox", { name: "载入哪一修订" });
		await user.click(picker);
		const listbox = document.getElementById(picker.getAttribute("aria-controls") ?? "");
		await user.click(
			within(listbox as HTMLElement).getByRole("option", { name: "#2 · 旧修订", hidden: true }),
		);
		await waitFor(() => expect(mocks.getSource).toHaveBeenCalledWith(PACK_KEY, 7));
		expect(await screen.findByText(/保存仍会追加新修订/)).toBeInTheDocument();
	});
});

describe("场景编辑器：历史形状的修订只读，编辑要显式转换", () => {
	beforeEach(() => {
		mocks.getSource.mockResolvedValue(legacySource());
		mocks.convert.mockResolvedValue(converted());
	});

	it("只读：原样给出这份旧修订的 JSON，没有任何保存控件", async () => {
		renderPanel();

		const editor = await screen.findByTestId("json-editor");
		expect(editor).toHaveAttribute("data-readonly", "true");
		// 原样：认不出的字段还在，没有被静默裁剪/改写
		expect((editor as HTMLTextAreaElement).value).toContain('"deadline_turns": 2');
		expect(screen.getByText(/形状 v1 · 只读历史修订/)).toBeInTheDocument();
		// 读不出形状的字段照样逐条列出（路径 + 说明）
		expect(screen.getByText("anchors")).toBeInTheDocument();
		expect(screen.getByText(/锚点任务状态机已移除/)).toBeInTheDocument();

		// 保存控件一个都不给
		expect(screen.queryByRole("button", { name: /保存（追加新修订）/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "保存并试跑" })).toBeNull();
		expect(screen.queryByLabelText("这次改了什么（写进修订说明）")).toBeNull();
	});

	it("转换动作打的是这份修订，结果载入为**未保存的草稿**，保存打的是转换后的内容", async () => {
		const user = userEvent.setup();
		renderPanel();

		await user.click(await screen.findByRole("button", { name: /转换到 v3 草稿/ }));
		expect(mocks.convert).toHaveBeenCalledWith(PACK_KEY, 7);

		// 草稿：表单可编辑，且明确说它还没成为修订
		expect(await screen.findByLabelText("标题")).toHaveValue("转换后的标题");
		expect(screen.getByText("未保存的转换草稿")).toBeInTheDocument();
		expect(screen.getByText(/已载入转换草稿：v1 → v3/)).toBeInTheDocument();
		expect(mocks.save).not.toHaveBeenCalled();

		// 保存打的是**转换后的内容**（那份旧修订一个字节都没动）
		await user.click(saveButton());
		await waitFor(() => expect(mocks.save).toHaveBeenCalled());
		const [key, content] = mocks.save.mock.calls[0] as [
			string,
			Record<string, unknown>,
			string,
		];
		expect(key).toBe(PACK_KEY);
		expect(content.title).toBe("转换后的标题");
	});

	it("转换结果不是可编辑的 JSON 表时不载入草稿：仍只读、仍没有保存控件", async () => {
		const user = userEvent.setup();
		mocks.convert.mockResolvedValue(converted({ content: undefined }));
		renderPanel();

		await user.click(await screen.findByRole("button", { name: /转换到 v3 草稿/ }));

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				"转换结果不是可编辑的 JSON 表，没有载入草稿",
			),
		);
		expect(screen.queryByText("未保存的转换草稿")).toBeNull();
		expect((await screen.findByTestId("json-editor"))).toHaveAttribute(
			"data-readonly",
			"true",
		);
		expect(screen.queryByRole("button", { name: /保存（追加新修订）/ })).toBeNull();
	});
});

describe("场景编辑器：校验与保存", () => {
	it("没有改动时保存按钮不可用（避免空提交）", async () => {
		renderPanel();
		await screen.findByLabelText("标题");
		expect(saveButton()).toBeDisabled();
	});

	it("校验失败：按节给出跳转入口，认不出节的问题连字段路径一起列出", async () => {
		mocks.validate.mockResolvedValue({
			ok: false,
			problems: [
				{ path: "affordances[suction].type", message: "类型 act 不在 player.can 中" },
				{ path: "state_keys.scene.spo2", message: "这个状态键没有任何判据在读" },
			],
			content_sha: null,
			latest_sha: "cafebabe",
			will_append: false,
			next_revision_no: null,
			pack_schema_version: 3,
		});
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(saveButton());

		expect(await screen.findByText("校验未通过")).toBeInTheDocument();
		// 归位到节：给的是跳转入口，不是把整条路径丢出来让作者自己找
		expect(screen.getByRole("button", { name: "跳到「可做动作」" })).toBeInTheDocument();
		// 认不出属于哪一节：原样列出路径与说明（只在顶部摘要里出现）
		expect(screen.getByText("state_keys.scene.spo2")).toBeInTheDocument();
		expect(screen.getByText("这个状态键没有任何判据在读")).toBeInTheDocument();
		// 校验没过：一步都不往保存走
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("校验通过：确认框写明目标修订号与改动字段，确认后才保存", async () => {
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(saveButton());

		await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
		const options = mocks.confirm.mock.calls[0]?.[0] as { title: string; message: string };
		expect(options.title).toContain("修订 #4");
		expect(options.message).toContain("title");

		await waitFor(() => expect(mocks.save).toHaveBeenCalled());
		expect(mocks.validate).toHaveBeenCalledWith(
			PACK_KEY,
			expect.objectContaining({ title: "改过的标题" }),
		);
		const [key, content, note] = mocks.save.mock.calls[0] as [
			string,
			Record<string, unknown>,
			string,
		];
		expect(key).toBe(PACK_KEY);
		expect(content.title).toBe("改过的标题");
		expect(note).toBe("");
		// 追加修订的出口：不试跑就不开会话
		expect(mocks.createSession).not.toHaveBeenCalled();
	});

	it("内容与最新修订一致时，不弹确认框、不保存", async () => {
		mocks.validate.mockResolvedValue({
			ok: true,
			problems: [],
			content_sha: "cafebabe",
			latest_sha: "cafebabe",
			will_append: false,
			next_revision_no: null,
			pack_schema_version: 3,
		});
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(saveButton());

		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith("内容与当前最新修订一致，不需要保存"),
		);
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("保存返回 created=false 时如实说「复用」而不是假装追加了新修订", async () => {
		mocks.save.mockResolvedValue({
			key: PACK_KEY,
			revision_id: 8,
			revision_no: 3,
			created: false,
			assets_pending: [],
		});
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(saveButton());

		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith("内容未变：复用修订 #3"),
		);
		expect(mocks.createSession).not.toHaveBeenCalled();
	});

	it("保存并试跑：先追加修订，再用**刚保存的那份**开一局 trial 会话并跳到学生侧控制台", async () => {
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(trialButton());

		await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
		const options = mocks.confirm.mock.calls[0]?.[0] as { title: string; message: string };
		expect(options.title).toContain("修订 #4");
		expect(options.message).toContain("trial");

		await waitFor(() => expect(mocks.save).toHaveBeenCalled());
		// 试跑快照没有写说明时给一个诚实的默认值（修订历史里能认出这是试跑留下的）
		expect(mocks.save.mock.calls[0]?.[2]).toBe("试跑快照");

		await waitFor(() =>
			expect(mocks.createSession).toHaveBeenCalledWith({
				pack_key: PACK_KEY,
				revision_id: 9,
				trial: true,
			}),
		);
		await waitFor(() =>
			expect(screen.getByTestId("location")).toHaveTextContent("/scenario?session=77"),
		);
	});
});
