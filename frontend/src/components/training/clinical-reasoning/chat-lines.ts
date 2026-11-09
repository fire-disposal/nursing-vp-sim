/** 对话里的一条（合并后的视图模型）：持久化消息 + 本端未落库的气泡。 */
export interface ClinicalChatLine {
	/** 稳定的 React key（`record-message:<id>` / `local:<id>`）。 */
	key: string;
	role: string;
	content: string;
	/** 正在等待服务端（只有本地追加的学生气泡会短暂处于这个状态）。 */
	sending: boolean;
	/** 服务端消息 id —— 证据定位用它，本地气泡没有。 */
	messageId: number | null;
}
