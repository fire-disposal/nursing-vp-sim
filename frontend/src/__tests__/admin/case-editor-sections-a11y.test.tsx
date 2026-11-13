/**
 * 患者信息 / 人格配置分区 —— 可访问名称回归。
 *
 * 之前这些控件用视觉文字当标签（`<Text>` 兄弟节点），浏览器可访问树里名称是空的：
 * 读屏只念"编辑框"、语音输入点不了名。这里断言每个控件都能按中文名定位，
 * 同时锁住值契约（姓名/年龄/性别、人格六个字段、沟通风格）没被这个改动动过。
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { render } from "@/__tests__/render";
import type { CaseJsonValue } from "@/components/admin/cases/CaseEditorState";
import { useCaseEditor } from "@/components/admin/cases/CaseEditorState";
import { PatientSection } from "@/components/admin/cases/PatientSection";
import { PersonalitySection } from "@/components/admin/cases/PersonalitySection";

const INITIAL: Record<string, CaseJsonValue> = {
	patient_info: { name: "李秀兰", age: 64, gender: "女" },
	communication_style: "说话很急，带点方言口音。",
	personality: {
		health_literacy: "medium",
		verbosity: "terse",
		anxiety_trait: "anxious",
		patience: "low",
		mood: "fearful",
		compliance: "dependent",
	},
};

/** 把 useCaseEditor 的 state/dispatch 直接接到分区上：测的是分区本身，不是外壳。 */
function PatientHarness({ onJson }: { onJson: (json: Record<string, CaseJsonValue>) => void }) {
	const { state, dispatch } = useCaseEditor(INITIAL);
	onJson(state.json);
	return <PatientSection state={state} dispatch={dispatch} />;
}

function PersonalityHarness({ onJson }: { onJson: (json: Record<string, CaseJsonValue>) => void }) {
	const { state, dispatch } = useCaseEditor(INITIAL);
	onJson(state.json);
	return <PersonalitySection state={state} dispatch={dispatch} />;
}

describe("PatientSection · 可访问名称", () => {
	it("姓名/年龄/性别都能按中文名定位，且显示原值", () => {
		render(<PatientHarness onJson={() => {}} />);

		expect(screen.getByRole("textbox", { name: "患者姓名" })).toHaveValue("李秀兰");
		expect(screen.getByRole("textbox", { name: "患者年龄" })).toHaveValue("64");
		expect(screen.getByRole("combobox", { name: "患者性别" })).toHaveValue("女");
	});

	it("改名写回 patient_info.name，值契约不变", async () => {
		const user = userEvent.setup();
		let latest: Record<string, CaseJsonValue> = {};
		render(<PatientHarness onJson={(json) => { latest = json; }} />);

		const nameInput = screen.getByRole("textbox", { name: "患者姓名" });
		await user.clear(nameInput);
		await user.type(nameInput, "王芳");

		expect(latest.patient_info).toEqual({ name: "王芳", age: 64, gender: "女" });
	});
});

describe("PersonalitySection · 可访问名称", () => {
	it("六个人格字段各有一个具名下拉框，名称是中文标签", () => {
		render(<PersonalityHarness onJson={() => {}} />);

		for (const label of ["健康素养", "话量", "焦虑倾向", "耐心", "情绪基调", "依从性"]) {
			expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
		}
		expect(screen.getByRole("textbox", { name: "沟通风格描述" })).toHaveValue("说话很急，带点方言口音。");
	});

	it("改动人格下拉写回 personality.<key>，值契约不变", async () => {
		let latest: Record<string, CaseJsonValue> = {};
		render(<PersonalityHarness onJson={(json) => { latest = json; }} />);

		const mood = screen.getByRole("combobox", { name: "情绪基调" });
		fireEvent.mouseDown(mood);
		// Mantine 的选项列表按 raf 异步挂载，且六个下拉的选项同时存在于文档里，
		// 所以按名称 + 遍历取「情绪低落」，不依赖它是第几个 option。
		const option = await waitFor(() => {
			const found = Array.from(document.querySelectorAll('[role="option"]')).find(
				(el) => el.textContent === "情绪低落",
			);
			if (!found) throw new Error("选项未挂载");
			return found as HTMLElement;
		});
		fireEvent.click(option);

		expect((latest.personality as Record<string, CaseJsonValue>).mood).toBe("low");
		// 其它字段不受影响
		expect((latest.personality as Record<string, CaseJsonValue>).verbosity).toBe("terse");
	});
});
