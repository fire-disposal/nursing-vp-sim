import type { ClinicalOutboxEntry } from "./useClinicalReasoning";

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

interface PersistedChatMessage {
	id: number;
	role: string;
	content: string;
}

/** 本地气泡只补服务端详情尚未包含的消息；相同文本不能作为去重依据。 */
export function mergeClinicalChatLines(
	persisted: readonly PersistedChatMessage[],
	outbox: readonly ClinicalOutboxEntry[],
): ClinicalChatLine[] {
	const persistedIds = new Set(persisted.map((message) => message.id));
	return [
		...persisted.map((message) => ({
			key: `record-message:${message.id}`,
			role: message.role,
			content: message.content,
			sending: false,
			messageId: message.id,
		})),
		...outbox
			.filter((entry) => entry.persistedId === null || !persistedIds.has(entry.persistedId))
			.map((entry) => ({
				key: `local:${entry.id}`,
				role: entry.role,
				content: entry.content,
				sending: entry.sending,
				messageId: null,
			})),
	];
}
