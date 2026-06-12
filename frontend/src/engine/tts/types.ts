export interface TTSProvider {
	/** 朗读文本，返回 Promise 在朗读完成时 resolve */
	speak(text: string): Promise<void>;

	/** 立即停止朗读 */
	stop(): void;

	/** 是否正在朗读 */
	readonly speaking: boolean;

	/** 提供商标识（用于日志/调试） */
	readonly providerName: string;
}
