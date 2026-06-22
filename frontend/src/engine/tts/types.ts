export interface TTSProvider {
	/** 朗读文本，返回 Promise 在朗读完成时 resolve */
	speak(text: string): Promise<void>;

	/** 立即停止朗读 */
	stop(): void;

	/** 是否正在朗读 */
	readonly speaking: boolean;

	/** 提供商标识（用于日志/调试） */
	readonly providerName: string;

	/** 当前情绪状态（browser TTS 用于模拟语速/音调） */
	emotion?: string;

	/** 预缓冲：提前开始 TTS 合成，返回可播放的音频数据或 void */
	prebuffer?(text: string, recordId?: number): Promise<ArrayBuffer | undefined>;
}

export interface TTSManagerConfig {
	autoPlay?: boolean;
	recordId?: number;
}
