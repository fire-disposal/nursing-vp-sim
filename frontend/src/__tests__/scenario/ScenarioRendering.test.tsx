import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@/__tests__/render";
import { scenarioImageSrc, type ScenarioMessage, type ScenarioView } from "@/api/scenario";
import ScenarioStage from "@/scenario/ScenarioStage";
import { makeMessage, makeView } from "./fixtures";

/**
 * 场景画面区（`ScenarioStage`）的结构契约。
 *
 * 这里只钉**学生能看到的东西**：按情境时间单位成组与顺序、四类消息的结构差异与可读标签、
 * 「本段变化」的高亮、读数投影，以及图片「没声明 / 声明了但加载失败」的两种诚实表现。
 *
 * 图片用替身：真实 `AuthImage` 会走 axios 取 blob，在 jsdom 里只能靠 Mock 才能稳定地
 * 制造"已声明且加载失败"，并把**重试是否真的又试了一次**数出来（挂载次数就是证据）。
 */

const image = vi.hoisted(() => ({
	/** 每次 `AuthImage` 挂载时的 src；重试会换 key 重挂，所以次数 = 尝试次数。 */
	mounts: [] as string[],
	outcome: "error" as "loaded" | "error",
}));

// 替身只负责"报告加载状态"：状态的**消费**（错误说明、重试按钮）全部走真实组件代码。
vi.mock("@/components/ui/auth-image", () => ({
	default: function MockAuthImage({
		src,
		onStatus,
	}: {
		src: string;
		alt?: string;
		onStatus?: (status: "loaded" | "error") => void;
	}) {
		const report = useRef(onStatus);
		report.current = onStatus;
		useEffect(() => {
			image.mounts.push(src);
			report.current?.(image.outcome);
		}, [src]);
		return null;
	},
}));

/** 一条消息所在的整行（`.sc-line`）——按文本找，不看 class 顺序。 */
function lineOf(text: string): HTMLElement {
	const node = screen.getByText(text).closest(".sc-line");
	if (node === null) throw new Error(`没有找到这句话的对话行：${text}`);
	return node as HTMLElement;
}

/** 第 1 到第 3 个情境时间单位的完整历史：每段 2 条，四个角色类型都出现。 */
const HISTORY: ScenarioMessage[] = [
	makeMessage({ id: "t1.a", role: "scene", kind: "narration", text: "开场旁白：监护仪在响。", turn: 1 }),
	makeMessage({
		id: "t1.b",
		role: "actor",
		kind: "speech",
		actor: "patient",
		actor_role: "2 床患者",
		text: "患者先开口：我喘不上气。",
		turn: 1,
	}),
	makeMessage({
		id: "t2.a",
		role: "student",
		kind: "action",
		declaration: "act",
		target: { kind: "actor", id: "patient" },
		text: "我先给他吸氧。",
		turn: 2,
	}),
	makeMessage({ id: "t2.b", role: "scene", kind: "narration", text: "世界回应：氧流量 2 升。", turn: 2 }),
	makeMessage({ id: "t3.a", role: "system", kind: "blocked", text: "值班医生说现在不能离开。", turn: 3 }),
	makeMessage({ id: "t3.b", role: "scene", kind: "narration", text: "结尾旁白：他仍然费力。", turn: 3 }),
];

function historyView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return makeView({
		session: { id: 12, status: "active", turn: 3, lost: false, seq: 9, trial: false },
		messages: HISTORY,
		...overrides,
	});
}

const SCENE_IMAGE = {
	asset_id: "gen:1",
	url: "/api/scenario/assets/7/gen:1",
	title: "病区走廊",
	alt: "深夜走廊",
	caption: "",
	origin: "generated",
};

beforeEach(() => {
	image.mounts = [];
	image.outcome = "error";
});

describe("场景画面区：完整历史按时间单位成组", () => {
	it("第 1 到第 3 个单位全在，按序成组，各带「时间单位 N」标记与锚点", () => {
		render(<ScenarioStage view={historyView()} />);

		const groups = [...document.querySelectorAll(".sc-lines .sc-turn")];
		expect(groups.map((group) => group.getAttribute("data-turn"))).toEqual(["1", "2", "3"]);
		// 段落坐标是**情境时间单位**（用户裁定 2026-09-29）：`turn` 是累计的情境时间，
		// 不是"第几次提交"。说话与观察不消耗时间，所以标记写的是"时间单位 N"。
		const marks = groups.map(
			(group) => group.querySelector(".sc-turn-mark")?.textContent?.trim() ?? "",
		);
		expect(marks).toEqual(["时间单位 1", "时间单位 2", "时间单位 3"]);
		for (const mark of marks) expect(mark).toMatch(/^时间单位 \d+$/);
		// 学生面上没有「回合」这套旧口径
		expect(document.body.textContent).not.toContain("回合");
		// 锚点就是资料栏「时间单位 N」跳回来用的 id
		for (const turn of [1, 2, 3]) {
			expect(document.getElementById(`sc-turn-${turn}`)).not.toBeNull();
		}
		// 每一条都还在（不是只留最近几条）：这是"学生正在读的那一段不被挤掉"的前提
		for (const message of HISTORY) {
			expect(screen.getByText(message.text)).toBeInTheDocument();
		}
		expect(groups.map((group) => group.querySelectorAll(".sc-line").length)).toEqual([2, 2, 2]);
		// 顺序照旧：开场旁白在最后一段的系统消息之前
		expect(
			lineOf(HISTORY[0].text).compareDocumentPosition(lineOf(HISTORY[4].text)) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("稳定 id：同一视图重渲染不重挂、不复制行", () => {
		const { rerender } = render(<ScenarioStage view={historyView()} />);
		const before = document.querySelectorAll(".sc-lines .sc-line").length;
		const node = screen.getByText("世界回应：氧流量 2 升。");

		rerender(<ScenarioStage view={historyView()} />);

		expect(document.querySelectorAll(".sc-lines .sc-line")).toHaveLength(before);
		expect(document.querySelectorAll(".sc-lines .sc-turn")).toHaveLength(3);
		// 同一个 DOM 节点：接续是按稳定 id，不是销毁重建
		expect(screen.getByText("世界回应：氧流量 2 升。")).toBe(node);
	});
});

describe("场景画面区：四类消息的形状与可读标签", () => {
	function semanticsView(): ScenarioView {
		return makeView({
			session: { id: 12, status: "active", turn: 1, lost: false, seq: 4, trial: false },
			messages: [
				makeMessage({ id: "n1", role: "scene", kind: "narration", text: "监护仪在响。", turn: 1 }),
				makeMessage({
					id: "a1",
					role: "actor",
					kind: "speech",
					actor: "patient",
					actor_role: "2 床患者",
					text: "我……喘不上气。",
					turn: 1,
				}),
				makeMessage({
					id: "s1",
					role: "student",
					kind: "action",
					declaration: "act",
					target: { kind: "actor", id: "patient" },
					text: "先给他吸氧。",
					turn: 1,
				}),
				makeMessage({
					id: "s2",
					role: "student",
					kind: "speech",
					declaration: "say",
					target: { kind: "actor", id: "patient" },
					text: "您现在感觉怎么样？",
					turn: 1,
				}),
				makeMessage({ id: "y1", role: "system", kind: "blocked", text: "值班医生说现在不能离开。", turn: 1 }),
				makeMessage({ id: "y2", role: "system", kind: "unmodeled", text: "这种处置还没有建模。", turn: 1 }),
			],
		});
	}

	it("旁白 / 角色 / 学生 / 系统四类结构不同，且都带可读标签", () => {
		render(<ScenarioStage view={semanticsView()} />);

		expect(lineOf("监护仪在响。")).toHaveAttribute("data-role", "scene");
		expect(lineOf("我……喘不上气。")).toHaveAttribute("data-role", "actor");
		expect(lineOf("先给他吸氧。")).toHaveAttribute("data-role", "student");
		expect(lineOf("值班医生说现在不能离开。")).toHaveAttribute("data-role", "system");
		const roles = [...document.querySelectorAll(".sc-lines .sc-line")].map((line) =>
			line.getAttribute("data-role"),
		);
		expect([...new Set(roles)].sort()).toEqual(["actor", "scene", "student", "system"]);

		// 形状之外还有文字：不靠颜色或 12px 图标区分
		expect(within(lineOf("监护仪在响。")).getByText("旁白")).toBeInTheDocument();
		expect(within(lineOf("我……喘不上气。")).getByText("2 床患者")).toBeInTheDocument();
		// 学生说过什么要能读出**对象**与「说话 / 行动」
		expect(within(lineOf("先给他吸氧。")).getByText("对 2 床患者 · 行动")).toBeInTheDocument();
		expect(within(lineOf("您现在感觉怎么样？")).getByText("对 2 床患者 · 说话")).toBeInTheDocument();
		// 被阻止 / 未建模是引擎直出的说明，带自己的可读标签
		expect(within(lineOf("值班医生说现在不能离开。")).getByText("未能执行")).toBeInTheDocument();
		expect(within(lineOf("这种处置还没有建模。")).getByText("未建模")).toBeInTheDocument();
	});

	it("被阻止 / 未建模不当成告警：不是 alert，也没有错误样式", () => {
		render(<ScenarioStage view={semanticsView()} />);

		expect(lineOf("值班医生说现在不能离开。")).toHaveAttribute("data-kind", "blocked");
		expect(lineOf("这种处置还没有建模。")).toHaveAttribute("data-kind", "unmodeled");
		expect(screen.queryByRole("alert")).toBeNull();
		expect(document.querySelector(".sc-lines .sc-error")).toBeNull();
	});

	it("带来源的消息给「来源：」标签，没有来源就不留空壳", () => {
		render(
			<ScenarioStage
				view={makeView({
					messages: [
						makeMessage({
							id: "src",
							role: "scene",
							kind: "narration",
							text: "走廊里有人跑过。",
							turn: 1,
							sources: ["cue:c1", "event:7"],
						}),
						makeMessage({ id: "nosrc", role: "scene", kind: "narration", text: "没人跑过。", turn: 1 }),
					],
				})}
			/>,
		);

		expect(
			within(lineOf("走廊里有人跑过。")).getByText("来源：线索 c1、事件 #7"),
		).toBeInTheDocument();
		expect(lineOf("没人跑过。").querySelector(".sc-line-source")).toBeNull();
	});
});

describe("场景画面区：本段变化的高亮", () => {
	it("highlightTurn 只标记那一段的消息，其他段不带标记", () => {
		const { rerender } = render(<ScenarioStage view={historyView()} highlightTurn={2} />);

		const marked = [...document.querySelectorAll(".sc-lines [data-highlight]")];
		expect(marked).toHaveLength(2);
		expect(marked.every((line) => line.closest(".sc-turn")?.getAttribute("data-turn") === "2")).toBe(
			true,
		);
		expect(document.querySelectorAll("#sc-turn-1 [data-highlight]")).toHaveLength(0);
		expect(document.querySelectorAll("#sc-turn-3 [data-highlight]")).toHaveLength(0);

		rerender(<ScenarioStage view={historyView()} highlightTurn={null} />);
		expect(document.querySelectorAll(".sc-lines [data-highlight]")).toHaveLength(0);
	});
});

describe("场景画面区：读数与阶段", () => {
	it("只留仪器读数（state）；没有值显示「—」，内部 ref 不进学生面", () => {
		const { rerender } = render(
			<ScenarioStage
				view={makeView({
					hud: [
						{ slot: "血氧", source: "state", label: "血氧", value: 89, ref: "vitals.spo2" },
						{ slot: "体温", source: "state", label: "体温", value: null, ref: "vitals.temp" },
						{ slot: "线索", source: "cue", items: ["患者呼吸费力"] },
						{ slot: "在场", source: "actor", items: ["2 床患者"] },
					],
				})}
			/>,
		);

		const hud = document.querySelector(".sc-hud") as HTMLElement;
		expect(hud).not.toBeNull();
		expect(hud.querySelectorAll(".sc-hud-slot")).toHaveLength(2);
		expect(hud.querySelector('[data-source="cue"]')).toBeNull();
		expect(hud.querySelector('[data-source="actor"]')).toBeNull();
		expect(within(hud).getByText("89")).toBeInTheDocument();
		expect(within(hud).getByText("—")).toBeInTheDocument();
		for (const ref of ["vitals.spo2", "vitals.temp"]) {
			expect(document.body.textContent).not.toContain(ref);
		}

		// 一个 state slot 都没有：整块不渲染（不留空壳）
		rerender(
			<ScenarioStage view={makeView({ hud: [{ slot: "线索", source: "cue", items: ["x"] }] })} />,
		);
		expect(document.querySelector(".sc-hud")).toBeNull();
	});

	it("忙碌时给真实阶段文案；空闲时没有忙碌条", () => {
		const { rerender } = render(<ScenarioStage view={makeView()} phase="delivering" />);
		expect(screen.getByRole("status")).toHaveTextContent("正在生成回应");

		rerender(<ScenarioStage view={makeView()} phase={null} />);
		expect(screen.queryByRole("status")).toBeNull();
	});
});

describe("场景画面区：图片的两种诚实表现", () => {
	it("未声明的图不占空间，也不给失败说明", () => {
		render(<ScenarioStage view={makeView()} />);

		expect(document.querySelector(".sc-stage-visual")).toBeNull();
		expect(screen.queryByLabelText("情境图片")).toBeNull();
		expect(document.querySelector(".sc-image-error")).toBeNull();
		expect(image.mounts).toHaveLength(0);
		// 场景带照旧说清"这是哪"
		expect(screen.getByText("外科病房")).toBeInTheDocument();
	});

	it("已声明但加载失败：说明失败 + 可重试，不静默消失", async () => {
		const user = userEvent.setup();
		render(<ScenarioStage view={makeView({ images: [SCENE_IMAGE] })} />);

		const failure = await screen.findByRole("status");
		// 声明过的图失败是技术故障：学生仍看得见它本该是什么
		expect(failure.textContent).toContain("病区走廊");
		expect(failure.textContent).toMatch(/图片加载失败/);
		expect(image.mounts).toEqual([scenarioImageSrc(SCENE_IMAGE.url)]);

		await user.click(screen.getByRole("button", { name: "重试图片" }));
		// 重试是**真的又试了一次**：重新挂载 = 重新取图
		expect(image.mounts).toHaveLength(2);
	});

	it("情境图（资产缩略）加载失败同样保留身份与重试", async () => {
		const user = userEvent.setup();
		render(
			<ScenarioStage
				view={makeView({
					assets: [
						{ id: "a_room", title: "病房环境", alt: "", url: "/api/scenario/assets/7/a_room" },
					],
				})}
			/>,
		);

		const failure = await screen.findByRole("status");
		expect(failure.textContent).toContain("病房环境");
		await user.click(screen.getByRole("button", { name: "重试图片" }));
		expect(image.mounts).toHaveLength(2);
	});
});
