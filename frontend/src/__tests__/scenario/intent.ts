import type { UserEvent } from "@testing-library/user-event";
import { screen } from "@/__tests__/render";

/**
 * 学生**先选对象、再表达**：入口是输入条旁的「说话 / 行动」与「对象」下拉，
 * 两条通道之后路径完全相同（`docs/23` §7.4）。
 *
 * 这些是**交互入口**的唯一写法：模式名与对象名就是学生看到的文字，用例不再自己拼
 * 若干次 click 去猜控件顺序（文案一改，只有这里要跟着改）。
 */

/** 切到「说话」或「行动」。 */
export async function chooseMode(user: UserEvent, mode: "说话" | "行动"): Promise<void> {
	await user.click(screen.getByRole("button", { name: mode }));
}

/** 选择当前对象（下拉里的可读标签，例如「2 床患者」）。 */
export async function chooseTarget(user: UserEvent, label: string): Promise<void> {
	await user.selectOptions(screen.getByLabelText("当前对象（说话或行动的对象）"), label);
}

/** 在输入框打一句话并发送；未指定对象时用当前已选对象。 */
export async function submitLine(user: UserEvent, text: string): Promise<void> {
	await user.type(screen.getByRole("textbox", { name: /你要说的话|要尝试的行动/ }), text);
	await user.click(screen.getByRole("button", { name: "发送" }));
}
