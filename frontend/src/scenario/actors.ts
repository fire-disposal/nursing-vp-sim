/**
 * 在场者「可怎么接触」的唯一换算处。
 *
 * 后端 `Presence` 是封闭四值（`on_site` / `remote` / `callable` / `inaccessible`），
 * 但它只给机器值，怎么读、能不能点，全在呈现层决定——所以这里收口，
 * 让在场者条与页面的预填文案用同一份判据（两处各写一遍必然会漂）。
 *
 * 学生面只写**世界里成立的话**：`inaccessible` 不给任何提示词（"不在视野"是平台在解释
 * 自己的投影规则，不是病区里会发生的话），它在界面上的表现就是"灰着、点不动"。
 * 未知值原样显示、且按可交互处理：不认识的值不该被静默吞掉，也不该假装学生点不动。
 */

/** 在场者条上的接触提示词；`inaccessible` 是空串（不渲染提示，只灰着）。 */
export const PRESENCE_HINT: Record<string, string> = {
	on_site: "搭话",
	remote: "通话",
	callable: "可呼叫",
	inaccessible: "",
};

/** `inaccessible` 只能看到，**不给按钮**；其余三态都能接触。 */
export function presenceInteractive(presence: string): boolean {
	return presence !== "inaccessible";
}
