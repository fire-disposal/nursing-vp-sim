import type { VoicePhase } from "@/hooks/voiceTypes";

/** ASR 栏只描述识别链路状态，不混入 AEC/TTS 的故障。 */
export type AsrStatusTone = "gray" | "teal" | "yellow" | "red" | "blue";

export interface AsrStatusInput {
	phase: VoicePhase;
	supported: boolean;
	armed: boolean;
	speechActive: boolean;
	failed: boolean;
	basicVoiceMode: boolean;
	notice: string | null;
	transcript: string;
	/** 识别已停止，但采集/AEC3 仍在为右侧波形供数。 */
	monitoring?: boolean;
}

export interface AsrStatus {
	label: string;
	detail: string;
	tone: AsrStatusTone;
}

export function describeAsrStatus({
	phase,
	supported,
	armed,
	speechActive,
	failed,
	basicVoiceMode,
	notice,
	transcript,
	monitoring = false,
}: AsrStatusInput): AsrStatus {
	if (!supported) {
		return {
			label: "不可用",
			detail: "当前环境不支持语音输入，建议使用 Chrome 或 Edge",
			tone: "red",
		};
	}
	if (failed) {
		return {
			label: "已降级",
			detail: notice ?? "持续监听不可用，可改用文字输入",
			tone: "red",
		};
	}
	if (notice) {
		return {
			label: basicVoiceMode ? "基础模式" : "注意",
			detail: notice,
			tone: "yellow",
		};
	}
	if (phase === "sending") {
		return {
			label: "提交中",
			detail: "正在提交最后一句识别结果",
			tone: "blue",
		};
	}
	if (phase === "listening" || armed) {
		if (speechActive || transcript.trim()) {
			return {
				label: "识别中",
				detail: "已检测到说话，继续说完后自动提交",
				tone: "teal",
			};
		}
		return {
			label: "麦克风常开",
			detail: "正在等待说话",
			tone: "teal",
		};
	}
	if (phase === "ready") {
		return {
			label: "已就绪",
			detail: "点击开始进入持续识别",
			tone: "gray",
		};
	}
	if (monitoring) {
		return {
			label: "ASR 已停止",
			detail: "音频波形仍在监视，点击开始恢复识别",
			tone: "gray",
		};
	}
	return {
		label: "未开始",
		detail: "点击开始，麦克风常开进入持续识别",
		tone: "gray",
	};
}
