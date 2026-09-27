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
 * 移动端/触摸（docs/19 §四 U0-B 通过条件 4）：
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

const bus = { on: vi.fn(() => () => {}), emit: vi.fn(), off: vi.fn(), listEvents: vi.fn(() => []) };

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

/** 患者区里任何绝对/固定定位的子元素都会盖到对话区头上 —— 紧凑形态必须没有。 */
function overlayChildren(stage: HTMLElement): HTMLElement[] {
	return Array.from(stage.querySelectorAll<HTMLElement>("*")).filter(
		(el) => el.style.position === "absolute" || el.style.position === "fixed",
	);
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

describe("紧凑患者区：竖屏手机（390x844）", () => {
	it("收为紧凑头，大图默认不挂载 —— 开场卡不再被四层堆叠挤出视口", () => {
		setViewport(390, 844);
		const { container } = renderWithWelcomeCard();
		const stage = patientStage(container);
		const welcomeHost = screen.getByTestId("welcome-host");

		expect(stage).toHaveAttribute("data-patient-mode", "compact");
		expect(stage).toHaveStyle({ width: "100%", position: "relative" });
		// 大图内容默认不挂载（原来占掉绝大部分高度的那块）
		expect(container.querySelector("[data-patient-stage-content]")).toBeNull();
		expect(bigFace(container)).toBeUndefined();
		// 第一次进来就知道患者是谁、为什么来（姓名 + 主诉一行）
		expect(stage).toHaveTextContent("王建国");
		expect(stage).toHaveTextContent("主诉：喘不上气");
		expect(screen.getByLabelText("展开患者区")).toBeInTheDocument();
		// 情绪是持续观察项：竖屏紧凑形态下常驻，不因收起大图而丢失
		expect(stage).toHaveTextContent("正常交流");

		// 开场卡就在患者区之后的文档流里，且患者区没有覆盖层
		expect(stage.compareDocumentPosition(welcomeHost) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(welcomeHost).toBeVisible();
		expect(overlayChildren(stage)).toEqual([]);
	});

	it("点开紧凑头仍能看到大图（收起 ≠ 删除）", async () => {
		setViewport(390, 844);
		const { container } = renderWithWelcomeCard();

		fireEvent.click(screen.getByLabelText("展开患者区"));
		await waitFor(() => expect(container.querySelector("[data-patient-stage-content]")).not.toBeNull());
		expect(bigFace(container)).toBeDefined();
		expect(screen.getByLabelText("折叠患者区")).toBeInTheDocument();
	});
});

describe("紧凑患者区：横屏手机（844x390）", () => {
	it("收为 88px 窄条（头像 + 姓名 + 把手竖排），给开场卡正文让出宽度", () => {
		setViewport(844, 390);
		const { container } = renderWithWelcomeCard();
		const stage = patientStage(container);

		expect(stage).toHaveAttribute("data-patient-mode", "compact");
		expect(stage).toHaveStyle({ width: "88px" });
		expect(container.querySelector("[data-patient-stage-content]")).toBeNull();
		expect(container.querySelector("[data-patient-stage-head]")).toHaveStyle({ flexDirection: "column" });
		expect(screen.getByLabelText("展开患者区")).toBeInTheDocument();
		// 窄条形态同样不产生覆盖层：开场卡（对话区那一列）不会被盖住
		const welcomeHost = screen.getByTestId("welcome-host");
		expect(stage.compareDocumentPosition(welcomeHost) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(welcomeHost).toBeVisible();
		expect(overlayChildren(stage)).toEqual([]);
	});

	it("展开后才占 280px 并显示大图", async () => {
		setViewport(844, 390);
		const { container } = renderWithWelcomeCard();
		const stage = patientStage(container);

		fireEvent.click(screen.getByLabelText("展开患者区"));
		// 先等内容挂载（Transition 换态在 effect 里），再断言宽度与大图，避免竞态假阴性
		await waitFor(() => expect(container.querySelector("[data-patient-stage-content]")).not.toBeNull());
		expect(stage).toHaveStyle({ width: "280px" });
		expect(bigFace(container)).toBeDefined();
	});
});

describe("宽屏仍是完整形态（1440x900 不回归）", () => {
	it("280px 方框 + 常驻大图", () => {
		setViewport(1440, 900);
		const { container } = renderWithWelcomeCard();
		const stage = patientStage(container);

		expect(stage).toHaveAttribute("data-patient-mode", "full");
		expect(stage).toHaveStyle({ width: "280px" });
		expect(container.querySelector("[data-patient-stage-content]")).not.toBeNull();
		expect(bigFace(container)).toBeDefined();
	});
});

describe("触摸目标 ≥44px", () => {
	// jsdom 无排版：getBoundingClientRect 恒为 0，因此断言的是**声明的命中区**（px，不随主题字号缩放）
	it("能力条按钮（竖屏）", () => {
		setViewport(390, 844);
		render(withTrainingData(<ActivityBar />, session()));
		const button = within(screen.getByLabelText("训练能力条")).getByRole("button", { name: /护理记录/ });
		expect(button).toHaveStyle({ minHeight: "44px" });
	});

	it("侧栏图标按钮（横屏/宽屏）", () => {
		setViewport(1440, 900);
		render(withTrainingData(<ActivityRail />, session()));
		const button = screen.getByLabelText("护理记录（草稿未提交）");
		expect(button).toHaveStyle({ minWidth: "44px", minHeight: "44px" });
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
