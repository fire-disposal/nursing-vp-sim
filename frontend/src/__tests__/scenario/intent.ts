import type { UserEvent } from "@testing-library/user-event";
import { screen } from "@/__tests__/render";
import { CUSTOM_ACTION_LABEL } from "@/scenario/ActionBar";

/**
 * 学生**先声明、再说话**：没选 chip 就发不出去（见 `scenario/ActionBar.tsx`）。
 *
 * 控制台级的用例大多不关心"对谁说"，只借自由通道把一句内容送进去 —— 统一选「自定义行动」。
 * 「对在场者说话」（`type=say` + 收信人）另有专门的用例，不在这里代劳。
 */
export async function chooseCustomAction(user: UserEvent): Promise<void> {
	await user.click(screen.getByRole("button", { name: CUSTOM_ACTION_LABEL }));
}
