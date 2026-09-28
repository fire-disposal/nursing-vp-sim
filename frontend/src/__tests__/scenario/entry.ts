import type { UserEvent } from "@testing-library/user-event";
import { screen } from "@/__tests__/render";

/**
 * 从入口页**开始一个情境**。
 *
 * 卡片本身不是按钮（开启一次情境要跑一个 LLM 开场回合，不能靠误点触发）：入口是卡片里那个
 * 贴底的实心动作，可访问名是 `开始「病例名」`（见 `scenario/ScenarioConsole.tsx` 的 `aria-label`）。
 * 卡片名在各用例里都叫 `PACK.title`，所以统一走这里，改文案时只改一处。
 */
export async function startPack(user: UserEvent, title: string): Promise<void> {
	await user.click(await screen.findByRole("button", { name: `开始「${title}」` }));
}
