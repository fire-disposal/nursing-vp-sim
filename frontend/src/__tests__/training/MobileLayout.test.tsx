import { Box, Text } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setViewport } from "@/__tests__/setup";
import { makeActivity, makeManifest } from "@/__tests__/fixtures/manifest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@/__tests__/render";
import PatientStage from "@/components/training/PatientStage";
import ActivityBar from "@/components/training/workspace/ActivityBar";
import { ActivityRail } from "@/components/training/workspace/ActivityRail";
import { useTrainingStore } from "@/stores/trainingStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * 移动端/触摸：
 *
 * - 竖屏手机 390x844：患者大图 + 能力条 + 完成阻断条 + 输入框四层堆叠会把开场卡挤到不可读
 *   → 患者区收为紧凑头，大图按需展开；
 * - 横屏手机 844x390：左栏大图吃掉整个高度 → 收为 88px 窄条，给开场卡正文让出宽度；
 * - 触摸目标：侧栏图标与能力条按钮命中区 ≥44px；
 * - 宿主不变：横屏只有右侧栏，竖屏只有底部能力条（不会出现第二个抽屉）。
 *
 * 关于「不遮挡」：jsdom 没有排版引擎（所有 getBoundingClientRect 都是 0），所以这里断言的是
 * **可证明的结构前提** —— 患者区在文档流内（position: relative，不产生 absolute/fixed 覆盖层）、
 * 默认不挂载大图内容（不占高）、且按文档顺序排在开场卡之前。
 * 真实像素级遮挡由维护者在浏览器复验（1440x900 / 390x844 / 844x390）。
 */

const bus = { on: vi.fn(() => () => {}), emit: vi.fn(), off: vi.fn() };

function session() {
	useTrainingStore.setState({ bus: bus as never, recordId: "1", trainingEnded: false });
	return makeRecord({
		mode: "guided",
		// 情绪栏是**内置特性**门控的（EmotionIndicator 在 features.emotion 为假时返回 null）：
		// 夹具不喂这个开关，就等于在测一个本病例没启用情绪能力的会话。
		features: { emotion: true },
		manifest: {
			...makeManifest({
				activities: [
					makeActivity("nursing_record", {
						label: "护理记录",
						artifact_kind: "nursing_record",
						ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
					}),
				],
				artifacts: {
					nursing_record: { required: true, state: "draft", submitted_at: null, updated_at: null },
				},
			}),
		},
	});
}

/**
 * 复刻 TrainingEngine 的三区结构：患者区与开场卡是同一个 column flex 的兄弟。
 * `data-testid="welcome-host"` 就是开场卡在布局里的位置（不 import WelcomeScreen，
 * 避免与开场改造的并行改动耦合）。
 */
function renderWithWelcomeCard() {
	return render(
		withTrainingData(
			<>
				<PatientStage />
				<Box data-testid="welcome-host" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
					<Text>开场卡正文</Text>
				</Box>
			</>,
			session(),
		),
	);
}

function patientStage(container: HTMLElement): HTMLElement {
	return container.querySelector("[data-patient-stage]") as HTMLElement;
}

/** 大图 = 定尺寸 160px 的竖屏大脸，或 fill（width: 100%）的并排大脸。 */
function bigFace(container: HTMLElement): HTMLImageElement | undefined {
	return Array.from(container.querySelectorAll("img")).find((img) => {
		const el = img as HTMLImageElement;
		return el.style.width === "100%" || el.style.width === "160px";
	});
}

/** `fixed` 定位的子元素会脱离文档流盖到对话区头上 —— 患者区（条/列）必须没有。 */
function fixedChildren(stage: HTMLElement): HTMLElement[] {
	return Array.from(stage.querySelectorAll<HTMLElement>("*")).filter((el) => el.style.position === "fixed");
}

beforeEach(() => {
	useWorkspaceStore.getState().resetWorkspace();
});

afterEach(() => {
	cleanup();
	useTrainingStore.getState().reset();
	useWorkspaceStore.getState().resetWorkspace();
	setViewport(1024, 768);
});

describe("患者条：竖屏手机（390x844）", () => {
	it("一条 56px 患者条（姓名 + 主诉 + 情绪），大图不挂载", () => {
		setViewport(390, 844);
		const { container } = renderWithWelcomeCard();
		const stage = patientStage(container);

		expect(stage).toHaveAttribute("data-patient-mode", "compact");
		expect(stage).toHaveTextContent("王建国");
		expect(stage).toHaveTextContent("主诉：喘不上气");
		// 采集进度与身份同处一屏也不许把姓名挤掉（曾因 chip 同行而截断到 0 宽）
		expect(stage.textContent).toContain("王建国");
		// 情绪是持续观察项：患者条上常驻
		expect(stage).toHaveTextContent("正常交流");
		// 大图（fill / 160px 大脸）默认不挂载：纵向空间全留给对话
		expect(bigFace(container)).toBeUndefined();
		// 患者条不产生覆盖层：开场卡与对话区不会被盖住
		expect(stage.compareDocumentPosition(screen.getByTestId("welcome-host")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(fixedChildren(stage)).toEqual([]);
	});

	it("点患者条打开大图浮层（收起 ≠ 删除）", async () => {
		setViewport(390, 844);
		const { container } = renderWithWelcomeCard();

		fireEvent.click(container.querySelector("[data-patient-stage-head]") as HTMLElement);

		await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
		expect(bigFace(screen.getByRole("dialog"))).toBeDefined();
		expect(screen.getByRole("dialog")).toHaveTextContent("王建国");
	});
});

describe("患者上下文列：≥ 768px（含横屏手机 844x390）", () => {
	it("横屏手机：248px 常驻列 + 常驻大图，且不引入覆盖层", () => {
		setViewport(844, 390);
		const { container } = renderWithWelcomeCard();
		const stage = patientStage(container);

		expect(stage).toHaveAttribute("data-patient-mode", "full");
		expect(stage).toHaveStyle({ width: "248px" });
		expect(bigFace(container)).toBeDefined();
		expect(fixedChildren(stage)).toEqual([]);
	});

	it("桌面 1440x900 是同一形态（同一个组件，不再分叉两套布局）", () => {
		setViewport(1440, 900);
		const { container } = renderWithWelcomeCard();
		const stage = patientStage(container);

		expect(stage).toHaveAttribute("data-patient-mode", "full");
		expect(stage).toHaveStyle({ width: "248px" });
		expect(bigFace(container)).toBeDefined();
	});
});

describe("触摸目标 ≥44px", () => {
	// jsdom 无排版：getBoundingClientRect 恒为 0，因此断言的是**声明的命中区**（px，不随主题字号缩放）
	it("能力条按钮（竖屏）", () => {
		setViewport(390, 844);
		render(withTrainingData(<ActivityBar />, session()));
		const button = within(screen.getByLabelText("训练能力条")).getByRole("button", { name: /护理记录/ });
		expect(button).toHaveStyle({ height: "44px" });
	});

	it("侧栏图标按钮（横屏/宽屏）", () => {
		setViewport(1440, 900);
		render(withTrainingData(<ActivityRail />, session()));
		const button = screen.getByLabelText("护理记录（草稿未提交）");
		expect(button).toHaveStyle({ height: "44px" });
	});
});

describe("紧凑患者区不引入第二个抽屉", () => {
	it("竖屏手机 + 紧凑患者区：只有底部能力条，右侧栏不渲染", () => {
		setViewport(390, 844);
		render(
			withTrainingData(
				<>
					<PatientStage />
					<ActivityRail />
					<ActivityBar />
				</>,
				session(),
			),
		);
		expect(screen.getByLabelText("训练能力条")).toBeInTheDocument();
		expect(screen.queryByLabelText("训练能力侧栏")).toBeNull();
	});

	it("横屏手机 + 紧凑患者区：只有右侧栏，底部能力条不渲染", () => {
		setViewport(844, 390);
		render(
			withTrainingData(
				<>
					<PatientStage />
					<ActivityRail />
					<ActivityBar />
				</>,
				session(),
			),
		);
		expect(screen.queryByLabelText("训练能力条")).toBeNull();
		expect(screen.getByLabelText("训练能力侧栏")).toBeInTheDocument();
	});
});
