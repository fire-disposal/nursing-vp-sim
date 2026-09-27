/**
 * 在场者「可怎么接触」的唯一换算处。
 *
 * 后端 `Presence` 是封闭四值（`on_site` / `remote` / `callable` / `inaccessible`），
 * 但它只给机器值，怎么读、能不能点，全在呈现层决定——所以这里收口，
 * 让在场者条与页面的预填文案用同一份判据（两处各写一遍必然会漂）。
 *
 * 未知值原样显示、且按可交互处理：不认识的值不该被静默吞掉，也不该假装学生点不动。
 */

const PRESENCE_HINT: Record<string, string> = {
	on_site: "搭话",
	remote: "通话",
	callable: "可呼叫",
	inaccessible: "不在视野",
};

/** 在场者条上的动作提示词。 */
export function presenceHint(presence: string): string {
	return PRESENCE_HINT[presence] ?? presence;
}

/** `inaccessible` 只能看到（"不在视野"），**不给按钮**；其余三态都能接触。 */
export function presenceInteractive(presence: string): boolean {
	return presence !== "inaccessible";
}

/** 点在场者时预填到自由通道的开场白（电话那头与叫得来人说法不同）。 */
export function talkPrefill(role: string, presence: string): string {
	if (presence === "remote") return `对电话那头的${role}说：`;
	if (presence === "callable") return `呼叫${role}：`;
	return `对${role}说：`;
}
