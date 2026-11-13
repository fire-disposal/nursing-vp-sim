/**
 * 病例列表的手机形态 —— 回归用例。
 *
 * 覆盖这次改动真正会坏的地方：
 * 1. 手机（<768px）渲染卡片、桌面渲染表格，**不会两组同时在 DOM 里**（否则读屏读两遍、
 *    学生可见开关变成两个同名控件）；
 * 2. 卡片上有名称链接、V1/V2、患者、难度、状态、学生可见开关、编辑/归档/删除；
 * 3. 卡片上的归档/删除走父层同一批回调（确认逻辑在 CasesTab，组件不得自己发请求）；
 * 4. 长病例名不截断（手机上截断等于看不到病例名）。
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import { setViewport } from "@/__tests__/setup";
import type { components } from "@/api/api-types.gen";
import CaseList, { type CaseListFilters } from "@/components/admin/cases/CaseList";

type CaseManageItem = components["schemas"]["CaseManageItem"];

const LONG_NAME = "社区获得性肺炎合并二型糖尿病史的老年患者术后肺部感染风险评估";

function makeCase(overrides: Partial<CaseManageItem> = {}): CaseManageItem {
	return {
		id: 1,
		name: "社区获得性肺炎",
		status: "published",
		current_revision_no: 3,
		patient_name: "张建国",
		patient_age: 68,
		patient_gender: "男",
		chief_complaint: "发热咳嗽三天",
		time_limit: 30,
		difficulty: 2,
		patient_personality: "normal",
		capabilities: {},
		workflow: { id: "history_taking", label: "病史采集", runtime_ready: true },
		is_open: true,
		created_at: "2026-11-01T00:00:00Z",
		training_count: 0,
		...overrides,
	};
}

const DRAFT_CASE = makeCase({
	id: 2,
	name: "慢性心衰急性加重",
	status: "draft",
	current_revision_no: null,
	difficulty: 3,
	is_open: false,
	workflow: { id: "clinical_reasoning", label: "证据驱动训练", runtime_ready: true },
});

const ARCHIVED_CASE = makeCase({
	id: 3,
	name: LONG_NAME,
	status: "archived",
	current_revision_no: 1,
	patient_age: 72,
	patient_gender: "女",
	workflow: { id: "clinical_reasoning", label: "证据驱动训练", runtime_ready: true },
});

const FILTERS: CaseListFilters = { name: "", difficulty: "", status: "", is_open: "" };

function renderList(props: Partial<React.ComponentProps<typeof CaseList>> = {}) {
	const onDelete = vi.fn();
	const onArchive = vi.fn();
	const onToggleOpen = vi.fn();
	render(
		<MemoryRouter>
			<CaseList
				cases={[makeCase(), DRAFT_CASE, ARCHIVED_CASE]}
				total={3}
				offset={0}
				limit={20}
				filters={FILTERS}
				hasFilters={false}
				searchInput=""
				caseHref={(id) => `/content/cases/${id}`}
				onSearchChange={vi.fn()}
				onFilterChange={vi.fn()}
				onOffsetChange={vi.fn()}
				onDelete={onDelete}
				onArchive={onArchive}
				onToggleOpen={onToggleOpen}
				{...props}
			/>
		</MemoryRouter>,
	);
	return { onDelete, onArchive, onToggleOpen };
}

/** 一张卡片：从它的名称链接往上找到带 data-testid 的那层。 */
function cardOf(name: string): HTMLElement {
	const link = screen.getByRole("link", { name });
	const card = link.closest('[data-testid="case-card"]');
	if (!card) throw new Error(`卡片容器缺失：${name}`);
	return card as HTMLElement;
}

beforeEach(() => {
	setViewport(390, 844); // 手机竖屏
});

describe("病例列表 · 手机卡片", () => {
	it("窄屏只渲染卡片，不渲染表格", () => {
		renderList();

		expect(screen.queryByRole("table")).not.toBeInTheDocument();
		expect(screen.getAllByTestId("case-card")).toHaveLength(3);
		// 卡片在可访问树里的名称链接（不是被 CSS 藏起来的表格）
		expect(screen.getByRole("link", { name: LONG_NAME })).toBeVisible();
	});

	it("卡片展示名称、代际、患者、难度与状态", () => {
		renderList();

		const published = cardOf("社区获得性肺炎");
		expect(within(published).getByText("V1")).toBeInTheDocument();
		expect(within(published).getByText("张建国 · 男 · 68岁")).toBeInTheDocument();
		expect(within(published).getByText("中级")).toBeInTheDocument();
		expect(within(published).getByText("已发布")).toBeInTheDocument();
		expect(within(published).getByText("v3")).toBeInTheDocument();

		const draft = cardOf("慢性心衰急性加重");
		expect(within(draft).getByText("V2")).toBeInTheDocument();
		expect(within(draft).getByText("高级")).toBeInTheDocument();
		expect(within(draft).getByText("草稿")).toBeInTheDocument();
		// 未发布没有学生可见开关，只有状态文字
		expect(within(draft).queryByRole("switch")).not.toBeInTheDocument();
		expect(within(draft).getByText("待发布")).toBeInTheDocument();

		const archived = cardOf(LONG_NAME);
		expect(within(archived).getByText("已归档")).toBeInTheDocument();
		expect(within(archived).getByText("不可用")).toBeInTheDocument();
	});

	it("学生可见开关使用中文可访问名称，点击走 onToggleOpen", async () => {
		const user = userEvent.setup();
		const { onToggleOpen } = renderList();

		const published = cardOf("社区获得性肺炎");
		const toggle = within(published).getByRole("switch", { name: "学生可见 社区获得性肺炎" });
		expect(toggle).toBeChecked();

		await user.click(toggle);
		expect(onToggleOpen).toHaveBeenCalledTimes(1);
		expect(onToggleOpen.mock.calls[0][0]).toMatchObject({ id: 1 });
	});

	it("归档/删除按钮有中文名称，且只回调父层（不另发请求）", async () => {
		const user = userEvent.setup();
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const { onArchive, onDelete } = renderList();

		const published = cardOf("社区获得性肺炎");
		await user.click(within(published).getByRole("button", { name: "归档" }));
		expect(onArchive).toHaveBeenCalledTimes(1);
		expect(onArchive.mock.calls[0][0]).toMatchObject({ id: 1, name: "社区获得性肺炎" });

		await user.click(within(published).getByRole("button", { name: "删除" }));
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(onDelete.mock.calls[0][0]).toMatchObject({ id: 1 });

		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("已归档卡片没有归档按钮，编辑入口改为「查看」", () => {
		renderList();

		const archived = cardOf(LONG_NAME);
		expect(within(archived).queryByRole("button", { name: "归档" })).not.toBeInTheDocument();
		expect(within(archived).getByRole("link", { name: "查看" })).toHaveAttribute("href", "/content/cases/3");
		expect(within(archived).getByRole("button", { name: "删除" })).toBeInTheDocument();
	});

	it("待处理中的卡片禁用行内操作", () => {
		renderList({ pendingId: 1 });

		const published = cardOf("社区获得性肺炎");
		expect(within(published).getByRole("switch", { name: "学生可见 社区获得性肺炎" })).toBeDisabled();
		expect(within(published).getByRole("button", { name: "归档" })).toBeDisabled();
		expect(within(published).getByRole("button", { name: "删除" })).toBeDisabled();
	});

	it("长病例名不截断：链接可换行且未设置 truncate", () => {
		renderList();

		const link = screen.getByRole("link", { name: LONG_NAME });
		expect(link.style.overflowWrap).toBe("anywhere");
		expect(link.style.whiteSpace).toBe("normal");
		expect(link.className).not.toMatch(/truncate/);
	});

	it("空态在手机上不套表格外壳", () => {
		renderList({ cases: [], total: 0 });

		expect(screen.queryByRole("table")).not.toBeInTheDocument();
		expect(screen.queryAllByTestId("case-card")).toHaveLength(0);
		expect(screen.getByText("尚未创建病例")).toBeInTheDocument();
	});
});

describe("病例列表 · 桌面表格", () => {
	it("宽屏保留表格形态，卡片不进 DOM（避免读屏读两套）", () => {
		setViewport(1280, 900);
		renderList();

		expect(screen.getByRole("table")).toBeInTheDocument();
		expect(screen.queryAllByTestId("case-card")).toHaveLength(0);
		expect(screen.queryByTestId("case-card-list")).not.toBeInTheDocument();
		// 同名开关在桌面也只有表格里的那一个
		expect(screen.getAllByRole("switch", { name: "学生可见 社区获得性肺炎" })).toHaveLength(1);
	});
});
