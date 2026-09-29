/**
 * 病例编辑器组件：两个页签的**双向同步**、保存前的**字段级定位**与**确认摘要**，
 * 以及**保存并试跑**这条出口。
 *
 * 这里钉的是行为，不是实现：
 * - 默认落在「表单」，表单改动让「JSON 原始」文本跟着变；
 * - 原始文本改动解析成功后表单跟着变；解析失败**保留文本**且**不清空表单**；
 * - 校验失败时按节给出跳转入口，认不出节的问题连字段路径一起列出；保存按钮背后一定先过校验；
 * - 保存**覆盖当前内容**：内容变了版本 +1，一样的内容重存不涨版本（`changed=false`）；
 * - 保存失败（422）如实列出后端的 `problems`，不吞成"保存失败请重试"；
 * - **保存并试跑**：先保存，再用这份病例开一局 `trial` 会话，跳到学生侧控制台。
 *
 * 组件在 Router 里（`useNavigate` 是那条试跑出口的一部分）：这里用 `MemoryRouter` + 一个位置探针，
 * 断言的是"跳到哪了"，不是"调没调 hook"。
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/__tests__/render";
import type { ScenarioAdminPack, ScenarioPackContent, ScenarioPackDoc } from "@/api/scenario";
import AdminCaseEditorPanel from "@/scenario/admin/AdminCaseEditorPanel";

const mocks = vi.hoisted(() => ({
	getContent: vi.fn(),
	validate: vi.fn(),
	save: vi.fn(),
	createSession: vi.fn(),
	confirm: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return {
		...actual,
		getAdminScenarioPackContent: mocks.getContent,
		validateAdminScenarioPack: mocks.validate,
		saveAdminScenarioPackContent: mocks.save,
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

const PACK: ScenarioAdminPack = {
	key: PACK_KEY,
	title: "吸痰无效：血氧上不来",
	one_line: "夜班，痰多却吸不出来。",
	version: 3,
	published: false,
	published_at: null,
	assets: [],
	overview: null,
	sessions: 0,
};

/** 当前内容（顶层是一张表）。 */
const CONTENT: ScenarioPackDoc = {
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

/** 一份**读不出形状**的内容（顶层不是对象）：编辑器只能说明读不出字段。 */
const NON_TABLE_CONTENT = [1, 2, 3] as unknown as { [key: string]: unknown };

/** 服务端此刻存着的那一份：读接口与存接口共用它（存了之后读到的就是新版本）。 */
let live: { version: number; content: ScenarioPackDoc; changed: boolean } = {
	version: 3,
	content: CONTENT,
	changed: false,
};

function contentResponse(overrides: Partial<ScenarioPackContent> = {}): ScenarioPackContent {
	return {
		key: PACK_KEY,
		title: PACK.title,
		one_line: PACK.one_line,
		version: live.version,
		published: false,
		published_at: null,
		content: live.content,
		problems: [],
		changed: live.changed,
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

const saveButton = () => screen.getByRole("button", { name: /^保存$/ });
const trialButton = () => screen.getByRole("button", { name: "保存并试跑" });

beforeEach(() => {
	live = { version: 3, content: CONTENT, changed: false };
	mocks.getContent.mockImplementation(() => Promise.resolve(contentResponse()));
	mocks.validate.mockResolvedValue({
		ok: true,
		problems: [],
		content_sha: "deadbeef",
		latest_sha: "cafebabe",
		will_change: true,
		version: 3,
	});
	mocks.save.mockImplementation((_key: string, content: ScenarioPackDoc) => {
		live = { version: live.version + 1, content, changed: true };
		return Promise.resolve(contentResponse());
	});
	mocks.createSession.mockResolvedValue({ session_id: 77 });
	mocks.confirm.mockResolvedValue(true);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("病例编辑器：载入与两个页签", () => {
	it("默认落在表单，且读的是这份病例的当前内容", async () => {
		renderPanel();
		expect(await screen.findByLabelText("标题")).toHaveValue(PACK.title);
		expect(screen.getByLabelText("一句话")).toHaveValue(PACK.one_line);
		expect(screen.getByLabelText("玩家角色")).toHaveValue("夜班护士");
		expect(mocks.getContent).toHaveBeenCalledWith(PACK_KEY);
		// 版本显示的是服务端记的那个数，界面不自己编
		expect(screen.getByText("版本 #3")).toBeInTheDocument();
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

	it("内容不是一张可编辑的 JSON 表：如实说读不出字段，不给任何保存控件", async () => {
		mocks.getContent.mockResolvedValue(contentResponse({ content: NON_TABLE_CONTENT }));
		renderPanel();

		expect(await screen.findByText(/不是一张可编辑的 JSON 表/)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /^保存$/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "保存并试跑" })).toBeNull();
	});

	it("载入不出来时给明确说明，不白屏", async () => {
		mocks.getContent.mockRejectedValue(new Error("boom"));
		renderPanel();
		expect(await screen.findByText(/载入病例内容失败/)).toBeInTheDocument();
	});
});

describe("病例编辑器：校验与保存", () => {
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
			will_change: false,
			version: 3,
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

	it("校验通过：确认框写明「版本 +1」与改动字段，确认后才保存", async () => {
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(saveButton());

		await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
		const options = mocks.confirm.mock.calls[0]?.[0] as { title: string; message: string };
		expect(options.title).toBe("保存？");
		expect(options.message).toContain("版本 +1");
		expect(options.message).toContain("现在是 #3");
		expect(options.message).toContain("title");

		await waitFor(() => expect(mocks.save).toHaveBeenCalled());
		expect(mocks.validate).toHaveBeenCalledWith(
			PACK_KEY,
			expect.objectContaining({ title: "改过的标题" }),
		);
		const [key, content] = mocks.save.mock.calls[0] as [string, ScenarioPackDoc];
		expect(key).toBe(PACK_KEY);
		expect(content.title).toBe("改过的标题");
		// 保存出口：不试跑就不开会话
		expect(mocks.createSession).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).toHaveBeenCalledWith("已保存为版本 #4");
	});

	it("内容与当前版本一致时，不弹确认框、不保存", async () => {
		mocks.validate.mockResolvedValue({
			ok: true,
			problems: [],
			content_sha: "cafebabe",
			latest_sha: "cafebabe",
			will_change: false,
			version: 3,
		});
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(saveButton());

		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith("内容与当前版本一致，不需要再存一次"),
		);
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("保存返回 changed=false 时如实说「仍是版本 #N」而不是假装存了新版本", async () => {
		mocks.save.mockImplementation((_key: string, content: ScenarioPackDoc) => {
			live = { version: live.version, content, changed: false };
			return Promise.resolve(contentResponse());
		});
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(saveButton());

		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith("内容没有变化：仍是版本 #3"),
		);
		expect(mocks.createSession).not.toHaveBeenCalled();
	});

	it("保存失败（422）：把后端逐条 problems 如实列出来，不用一句「保存失败」糊过去", async () => {
		mocks.save.mockRejectedValue({
			response: {
				status: 422,
				data: {
					detail: {
						message: "内容不合法",
						problems: ["affordances[0].type: 类型 act 不在 player.can 中"],
					},
				},
			},
		});
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(saveButton());

		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		const [message] = mocks.toastError.mock.calls[0] as [string];
		expect(message).toContain("内容不合法");
		expect(message).toContain("affordances[0].type: 类型 act 不在 player.can 中");
		expect(mocks.createSession).not.toHaveBeenCalled();
	});

	it("保存并试跑：先存下这一版，再用**这份病例**开一局 trial 会话并跳到学生侧控制台", async () => {
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(trialButton());

		await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
		const options = mocks.confirm.mock.calls[0]?.[0] as { title: string; message: string };
		expect(options.title).toBe("保存后试跑？");
		expect(options.message).toContain("试跑");

		await waitFor(() => expect(mocks.save).toHaveBeenCalled());
		await waitFor(() =>
			expect(mocks.createSession).toHaveBeenCalledWith({
				pack_key: PACK_KEY,
				trial: true,
			}),
		);
		await waitFor(() =>
			expect(screen.getByTestId("location")).toHaveTextContent("/scenario?session=77"),
		);
	});
});
