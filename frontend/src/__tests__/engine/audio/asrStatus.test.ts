import { describe, expect, it } from "vitest";
import { describeAsrStatus, type AsrStatusInput } from "@/engine/audio/asrStatus";

const base: AsrStatusInput = {
	phase: "idle",
	supported: true,
	armed: false,
	speechActive: false,
	failed: false,
	basicVoiceMode: false,
	notice: null,
	transcript: "",
};

describe("describeAsrStatus", () => {
	it("未开始时给出明确入口，而不是空白状态", () => {
		expect(describeAsrStatus(base)).toMatchObject({ label: "未开始", tone: "gray" });
	});

	it("常开但未检测到语音时显示等待说话", () => {
		expect(describeAsrStatus({ ...base, phase: "listening", armed: true })).toMatchObject({
			label: "麦克风常开",
			tone: "teal",
		});
	});

	it("有实时转写时升级为识别中", () => {
		expect(
			describeAsrStatus({ ...base, phase: "listening", armed: true, transcript: "我最近" }),
		).toMatchObject({ label: "识别中", detail: "已检测到说话，继续说完后自动提交" });
	});

	it("提交阶段与持续监听分开", () => {
		expect(describeAsrStatus({ ...base, phase: "sending", armed: true })).toMatchObject({
			label: "提交中",
			tone: "blue",
		});
	});

	it("降级和基础模式各自有可读原因", () => {
		expect(describeAsrStatus({ ...base, failed: true, notice: "已改为按住说话" })).toMatchObject({
			label: "已降级",
			detail: "已改为按住说话",
			tone: "red",
		});
		expect(
			describeAsrStatus({ ...base, armed: true, phase: "listening", basicVoiceMode: true, notice: "当前设备已使用基础语音模式" }),
		).toMatchObject({ label: "基础模式", tone: "yellow" });
	});

	it("ASR 停止但采集仍在时明确说明波形继续", () => {
		expect(describeAsrStatus({ ...base, monitoring: true })).toMatchObject({
			label: "ASR 已停止",
			detail: "音频波形仍在监视，点击开始恢复识别",
			tone: "gray",
		});
	});

	it("不支持语音输入时不显示成可开始", () => {
		expect(describeAsrStatus({ ...base, supported: false })).toMatchObject({
			label: "不可用",
			tone: "red",
		});
	});
});
