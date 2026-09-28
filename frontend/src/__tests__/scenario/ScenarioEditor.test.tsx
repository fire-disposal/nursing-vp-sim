/**
 * 场景编辑器组件：两个页签的**双向同步**、保存前的**字段级定位**与**确认摘要**。
 *
 * 这里钉的是行为，不是实现：
 * - 默认落在「表单」，表单改动让「JSON 原始」文本跟着变；
 * - 原始文本改动解析成功后表单跟着变；解析失败**保留文本**且**不清空表单**；
 * - 校验失败时给出字段路径（并按节归位），保存按钮背后一定先过校验；
 * - 确认框里写明"将追加修订 #N"与改动字段。
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type { ScenarioAdminPack, ScenarioAdminPackSource } from "@/api/scenario";
import AdminCaseEditorPanel from "@/scenario/admin/AdminCaseEditorPanel";

const mocks = vi.hoisted(() => ({
	getSource: vi.fn(),
	validate: vi.fn(),
	save: vi.fn(),
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
	};
});

vi.mock("@/components/ui/confirm", () => ({
	useConfirm: () => ({ confirm: mocks.confirm }),
}));

vi.mock("@/components/Toast", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

// Monaco 在 jsdom 里没有运行时：用可读的替身，让"文本 → 表单"这条链仍能被断言。
vi.mock("@monaco-editor/react", () => ({
	default: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
		<textarea
			data-testid="json-editor"
			value={value ?? ""}
			onChange={(event) => onChange?.(event.currentTarget.value)}
		/>
	),
}));

const PACK = {
	key: "sputum-ineffective",
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

function source(overrides: Partial<ScenarioAdminPackSource> = {}): ScenarioAdminPackSource {
	return {
		key: PACK.key,
		title: PACK.title,
		state: "experimental",
		revision_id: 8,
		revision_no: 3,
		note: "cli install",
		content: {
			pack_schema_version: 1,
			key: PACK.key,
			title: PACK.title,
			one_line: PACK.one_line,
			player: { role: "夜班护士" },
			setting: { place: "呼吸内科病房", cues: [{ id: "c1", text: "患者坐起前倾。" }] },
			actors: [{ id: "patient", role: "患者", presence: "on_site" }],
			affordances: [{ id: "suction", type: "act", label: "吸痰" }],
			facts: [],
			rubric: [],
			anchors: [],
			presentation: {},
		},
		problems: [],
		revisions: PACK.revisions,
		...overrides,
	};
}

function renderPanel() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<AdminCaseEditorPanel pack={PACK} />
		</QueryClientProvider>,
	);
}

/** 改一处表单文案（标题），用于制造"有改动"的状态。 */
async function editTitle(user: ReturnType<typeof userEvent.setup>, value: string) {
	const input = await screen.findByLabelText("标题");
	await user.clear(input);
	await user.type(input, value);
}

beforeEach(() => {
	mocks.getSource.mockResolvedValue(source());
	mocks.validate.mockResolvedValue({
		ok: true,
		problems: [],
		content_sha: "deadbeef",
		latest_sha: "cafebabe",
		will_append: true,
		next_revision_no: 4,
		pack_schema_version: 1,
	});
	mocks.save.mockResolvedValue({
		key: PACK.key,
		revision_id: 9,
		revision_no: 4,
		created: true,
		assets_pending: [],
	});
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
		expect(mocks.getSource).toHaveBeenCalledWith(PACK.key, undefined);
	});

	it("表单改动会同步到「JSON 原始」文本", async () => {
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(screen.getByRole("tab", { name: "JSON 原始" }));
		const editor = (await screen.findByTestId("json-editor")) as HTMLTextAreaElement;
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
		renderPanel();
		await screen.findByLabelText("标题");
		const picker = screen.getByRole("combobox", { name: "载入哪一修订" });
		await user.click(picker);
		const listbox = document.getElementById(picker.getAttribute("aria-controls") ?? "");
		await user.click(
			within(listbox as HTMLElement).getByRole("option", { name: "#2 · 旧修订", hidden: true }),
		);
		await waitFor(() => expect(mocks.getSource).toHaveBeenCalledWith(PACK.key, 7));
		expect(await screen.findByText(/保存仍会追加新修订/)).toBeInTheDocument();
	});
});

describe("场景编辑器：校验与保存", () => {
	it("没有改动时保存按钮不可用（避免空提交）", async () => {
		renderPanel();
		await screen.findByLabelText("标题");
		expect(screen.getByRole("button", { name: /保存（追加新修订）/ })).toBeDisabled();
	});

	it("校验失败：指明字段路径，并按节给出跳转入口", async () => {
		mocks.validate.mockResolvedValue({
			ok: false,
			problems: [
				{ path: "affordances[suction].type", message: "类型 act 不在 player.can 中" },
				{ path: "title", message: "文案含禁用词" },
			],
			content_sha: null,
			latest_sha: "cafebabe",
			will_append: false,
			next_revision_no: null,
			pack_schema_version: 1,
		});
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(screen.getByRole("button", { name: /保存（追加新修订）/ }));

		expect(await screen.findByText("校验未通过")).toBeInTheDocument();
		expect(await screen.findByText("affordances[suction].type")).toBeInTheDocument();
		expect(screen.getByText("类型 act 不在 player.can 中")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "跳到「可做动作」" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "跳到「基本信息」" })).toBeInTheDocument();
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("校验通过：确认框写明目标修订号与改动字段，确认后才保存", async () => {
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(screen.getByRole("button", { name: /保存（追加新修订）/ }));

		await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
		const options = mocks.confirm.mock.calls[0]?.[0] as { title: string; message: string };
		expect(options.title).toContain("修订 #4");
		expect(options.message).toContain("title");

		await waitFor(() => expect(mocks.save).toHaveBeenCalled());
		const [key, content, note] = mocks.save.mock.calls[0] as [string, Record<string, unknown>, string];
		expect(key).toBe(PACK.key);
		expect(content.title).toBe("改过的标题");
		expect(note).toBe("");
	});

	it("内容与最新修订一致时，不弹确认框、不保存", async () => {
		mocks.validate.mockResolvedValue({
			ok: true,
			problems: [],
			content_sha: "cafebabe",
			latest_sha: "cafebabe",
			will_append: false,
			next_revision_no: null,
			pack_schema_version: 1,
		});
		const user = userEvent.setup();
		renderPanel();
		await editTitle(user, "改过的标题");
		await user.click(screen.getByRole("button", { name: /保存（追加新修订）/ }));

		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("内容与当前最新修订一致，不需要保存"));
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.save).not.toHaveBeenCalled();
	});
});
