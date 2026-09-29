/**
 * 病例编辑器组件：四张页签（表单 / 散文 / 图片 / 原始）共用一份内容，
 * 保存前的**字段级定位**与**确认摘要**，以及**保存并试跑**这条出口。
 *
 * 这里钉的是行为，不是实现：
 * - 默认落在「表单」，版本号显示服务端记的那个数；
 * - 散文页签改的是同一份内容（改一处就"已修改 1 处"，保存时带走的是它）；
 * - 图片页签的声明跟着内容走：草稿有改动时**字节按钮禁用**（字节会挂到已保存的那一版上）；
 * - 校验失败时按**页签 + 节**给出跳转入口，认不出节的问题连字段路径一起列出；保存按钮背后一定先过校验；
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
import { caseZipBlob } from "./fixtures";

const mocks = vi.hoisted(() => ({
	getContent: vi.fn(),
	validate: vi.fn(),
	save: vi.fn(),
	createSession: vi.fn(),
	confirm: vi.fn(),
	assetUpload: vi.fn(),
	assetReplace: vi.fn(),
	assetDelete: vi.fn(),
	exportZip: vi.fn(),
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
		uploadAdminScenarioAsset: mocks.assetUpload,
		replaceAdminScenarioAsset: mocks.assetReplace,
		deleteAdminScenarioAsset: mocks.assetDelete,
		exportAdminScenarioPack: mocks.exportZip,
	};
});

vi.mock("@/components/ui/confirm", () => ({
	useConfirm: () => ({ confirm: mocks.confirm }),
}));

vi.mock("@/components/Toast", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const PACK_KEY = "sputum-ineffective";

const PACK: ScenarioAdminPack = {
	key: PACK_KEY,
	title: "吸痰无效：血氧上不来",
	one_line: "夜班，痰多却吸不出来。",
	version: 3,
	published: false,
	published_at: null,
	assets: [
		{
			id: "a_room",
			kind: "image",
			title: "病房环境",
			alt: "夜班病房",
			filename: "room-panel.png",
			mime_type: "image/png",
			file_size: 797,
			uploaded: true,
		},
	],
	overview: null,
	sessions: 0,
};

/** 当前内容（顶层是一张表，字段形状与后端存的一致）。 */
const CONTENT: ScenarioPackDoc = {
	key: PACK_KEY,
	title: PACK.title,
	one_line: PACK.one_line,
	brief: "夜里两点，病房里只剩监护仪在响。",
	player: { role: "夜班护士" },
	setting: {
		place: "呼吸内科病房",
		time_hint: "凌晨 02:10",
		resources: ["床旁吸引器"],
		cues: [{ id: "c_low_spo2", text: "指夹血氧上不来。", visible_from_start: true }],
	},
	state_keys: { "scene.spo2": 88 },
	state_bounds: { "scene.spo2": { lo: 0, hi: 100 } },
	truth: ["深部痰栓堵住了左侧气道。"],
	actors: [
		{
			id: "patient",
			role: "患者",
			presence: "on_site",
			demand: "quiet",
			knowledge: { 主诉: "喘不上来" },
			persona: "他说话断续费力。",
		},
	],
	affordances: [
		{
			id: "suction",
			type: "act",
			label: "吸痰",
			time_cost: 2,
			reveals: ["c_low_spo2"],
			targets: [{ kind: "actor", id: "patient" }],
			effects: [],
		},
	],
	facts: [],
	rubric: [],
	presentation: { devices: [] },
	assets: [{ id: "a_room", kind: "image", file: "room-panel.png", title: "病房环境", alt: "夜班病房", reveal_with: ["c_low_spo2"] }],
	failure: "recoverable",
	teacher_notes: "想让学生注意到吸痰无效。",
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
	// 「原始」页签读的是导出 zip：这里给一份与后端同形的真实 zip 字节
	mocks.exportZip.mockResolvedValue({ data: caseZipBlob() });
	mocks.confirm.mockResolvedValue(true);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("病例编辑器：载入与四张页签", () => {
	it("默认落在表单，读的是这份病例的当前内容", async () => {
		renderPanel();
		expect(await screen.findByLabelText("标题")).toHaveValue(PACK.title);
		expect(screen.getByLabelText("一句话")).toHaveValue(PACK.one_line);
		expect(screen.getByLabelText("玩家角色")).toHaveValue("夜班护士");
		expect(mocks.getContent).toHaveBeenCalledWith(PACK_KEY);
		// 版本显示的是服务端记的那个数，界面不自己编
		expect(screen.getByText("版本 #3")).toBeInTheDocument();
		for (const name of ["表单", "散文", "图片", "原始"]) {
			expect(screen.getByRole("tab", { name })).toBeInTheDocument();
		}
		// 引用都从已有 id 里选：动作的「揭示哪些线索」出现的是已声明的线索编号
		expect(screen.getAllByText("c_low_spo2").length).toBeGreaterThan(0);
	});

	it("散文页签改的是同一份内容：改一处就标「已修改」，保存带走的就是它", async () => {
		const user = userEvent.setup();
		renderPanel();
		await screen.findByLabelText("标题");
		await user.click(screen.getByRole("tab", { name: "散文" }));

		const brief = await screen.findByLabelText("处境");
		await user.clear(brief);
		await user.type(brief, "凌晨两点，痰堵住了。");
		expect(screen.getByText("已修改 1 处")).toBeInTheDocument();
		// 人物段落与真相都能看到（同一个人物在表单里也能改，这里只碰散文那一段）
		expect(screen.getByLabelText("他是怎样的人")).toHaveValue("他说话断续费力。");
		expect(screen.getByDisplayValue("深部痰栓堵住了左侧气道。")).toBeInTheDocument();

		await user.click(saveButton());
		await waitFor(() => expect(mocks.validate).toHaveBeenCalled());
		const [, content] = mocks.validate.mock.calls[0] as [string, ScenarioPackDoc];
		expect(content.brief).toBe("凌晨两点，痰堵住了。");
		expect(content.actors).toEqual(CONTENT.actors);
	});

	it("图片页签：声明跟内容走，草稿有改动时字节按钮禁用（先保存再传图）", async () => {
		const user = userEvent.setup();
		renderPanel();
		await screen.findByLabelText("标题");
		await user.click(screen.getByRole("tab", { name: "图片" }));

		expect(await screen.findByLabelText("编号")).toHaveValue("a_room");
		expect(screen.getByLabelText("替代文本")).toHaveValue("夜班病房");
		// 已上传的那张：按钮是「换一张」，干净状态下可用
		expect(screen.getByRole("button", { name: "换一张" })).toBeEnabled();

		// 改一处声明 → 有草稿 → 字节按钮停用（否则刚改的声明会被上传时的旧内容覆盖）
		const alt = screen.getByLabelText("替代文本");
		await user.type(alt, "改一处");
		await waitFor(() => expect(screen.getByRole("button", { name: "换一张" })).toBeDisabled());
	});

	it("原始页签：读导出包里的 TOML / MD 原文，只读", async () => {
		const user = userEvent.setup();
		renderPanel();
		await screen.findByLabelText("标题");
		await user.click(screen.getByRole("tab", { name: "原始" }));

		expect(await screen.findByText("case.toml")).toBeInTheDocument();
		expect(screen.getByText(/key = "demo"/)).toBeInTheDocument();
		expect(screen.getByText(/## 处境/)).toBeInTheDocument();
		// 只读：原文旁边只有「复制」，没有任何编辑入口
		const copyButtons = screen.getAllByRole("button", { name: "复制" });
		expect(copyButtons).toHaveLength(2);
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("原始页签：导出读不到时如实说读取失败，不显示一段空原文", async () => {
		mocks.exportZip.mockRejectedValue(new Error("boom"));
		const user = userEvent.setup();
		renderPanel();
		await screen.findByLabelText("标题");
		await user.click(screen.getByRole("tab", { name: "原始" }));
		expect(await screen.findByText(/读这份病例的原文失败/)).toBeInTheDocument();
	});

	it("内容不是一张可编辑的表：如实说读不出字段，不给任何保存控件", async () => {
		mocks.getContent.mockResolvedValue(contentResponse({ content: NON_TABLE_CONTENT }));
		renderPanel();

		expect(await screen.findByText(/不是一张可编辑的表/)).toBeInTheDocument();
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
				{
					path: "affordances[suction]",
					message: "affordance suction: select=single 但缺少 params.options",
				},
				{ path: "state_keys.scene.spo2", message: "这个状态键没有任何判据在读" },
				{ path: "(root)", message: "字段少了" },
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
		expect(screen.getByRole("button", { name: "跳到「动作」" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "跳到「状态键与边界」" })).toBeInTheDocument();
		// 认不出属于哪一节：原样列出路径与说明（只在顶部摘要里出现）
		expect(screen.getByText("(root)")).toBeInTheDocument();
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
						problems: ["affordance suction: 揭示了未知线索 c_missing"],
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
		expect(message).toContain("affordance suction: 揭示了未知线索 c_missing");
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
