import { beforeEach, describe, expect, it } from "vitest";
import {
	EMOTION_4D_LABELS,
	EMOTION_LABELS,
	getEmotionBorder,
	getEmotionColor,
	getTrainingState,
	useTrainingStore,
} from "@/stores/trainingStore";

const PATIENT = {
	name: "王建国",
	age: 68,
	gender: "male" as const,
	caseTitle: "慢阻肺",
};

function makeInit(overrides: Record<string, unknown> = {}) {
	return {
		bus: { on: () => () => {} } as never,
		recordId: "rec-1",
		patient: PATIENT,
		trainingType: "history_taking",
		capabilities: { quiz: true },
		timeLimitMinutes: 20,
		recordDetail: null,
		initialMessages: [],
		startTime: "2026-08-01T10:00:00Z",
		...overrides,
	};
}

beforeEach(() => {
	useTrainingStore.getState().reset();
});

describe("init / reset", () => {
	it("init populates state and defaults emotion", () => {
		useTrainingStore.getState().init(makeInit());
		const s = getTrainingState();
		expect(s.recordId).toBe("rec-1");
		expect(s.patient).toEqual(PATIENT);
		expect(s.emotion).toBe("neutral");
		expect(s.trust).toBe(50);
		expect(s.emotion4D).toBe("neutral");
	});

	it("init accepts valid emotionSeed state", () => {
		useTrainingStore
			.getState()
			.init(makeInit({ emotionSeed: { trust: 30, comfort: 70, state: "anxious" } }));
		const s = getTrainingState();
		expect(s.emotion).toBe("anxious");
		expect(s.trust).toBe(30);
		expect(s.comfort).toBe(70);
	});

	it("init rejects unknown emotionSeed state", () => {
		useTrainingStore
			.getState()
			.init(makeInit({ emotionSeed: { trust: 30, comfort: 70, state: "furious" } }));
		expect(getTrainingState().emotion).toBe("neutral");
	});

	it("reset restores initial defaults", () => {
		useTrainingStore.getState().init(makeInit());
		useTrainingStore.getState().reset();
		const s = getTrainingState();
		expect(s.recordId).toBe("");
		expect(s.patient).toBeNull();
		expect(s.messages).toEqual([]);
		expect(s.trainingEnded).toBe(false);
	});
});

describe("message flow", () => {
	it("addStudentMessage appends student + streaming patient placeholder", () => {
		const { studentId, placeholderId } = useTrainingStore.getState().addStudentMessage("我来了");
		const s = getTrainingState();
		expect(s.messages).toHaveLength(2);
		expect(s.messages[0]).toMatchObject({ id: studentId, role: "student", content: "我来了" });
		expect(s.messages[1]).toMatchObject({
			id: placeholderId,
			role: "patient",
			content: "",
			streaming: true,
		});
	});

	it("appendChunk accumulates content on placeholder", () => {
		useTrainingStore.getState().addStudentMessage("问诊");
		const { messages } = getTrainingState();
		const pid = messages[1].id as string;
		useTrainingStore.getState().appendChunk(pid, "你");
		useTrainingStore.getState().appendChunk(pid, "好");
		expect(getTrainingState().messages[1].content).toBe("你好");
	});

	it("finalizeMessage stops streaming and assigns server id", () => {
		useTrainingStore.getState().addStudentMessage("q");
		const pid = getTrainingState().messages[1].id as string;
		useTrainingStore.getState().finalizeMessage(pid, 77);
		const msg = getTrainingState().messages[1];
		expect(msg.streaming).toBe(false);
		expect(msg.id).toBe("77");
		expect(getTrainingState().sending).toBe(false);
	});

	it("handleStreamError keeps partial content with error flag", () => {
		useTrainingStore.getState().addStudentMessage("q");
		const { messages } = getTrainingState();
		const sid = messages[0].id as string;
		const pid = messages[1].id as string;
		useTrainingStore.getState().appendChunk(pid, "部分");
		useTrainingStore.getState().handleStreamError(sid, pid, "网络错误", true);
		const msg = getTrainingState().messages[1];
		expect(msg.streaming).toBe(false);
		expect(msg.streamError).toBe("网络错误");
		expect(getTrainingState().messages).toHaveLength(2);
	});

	it("handleStreamError removes both messages when no content", () => {
		useTrainingStore.getState().addStudentMessage("q");
		const { messages } = getTrainingState();
		const sid = messages[0].id as string;
		const pid = messages[1].id as string;
		useTrainingStore.getState().handleStreamError(sid, pid, "网络错误", false);
		expect(getTrainingState().messages).toHaveLength(0);
	});
});

describe("correction", () => {
	it("beginCorrection only works on the last student message", () => {
		const { studentId } = useTrainingStore.getState().addStudentMessage("第一条");
		useTrainingStore.getState().addStudentMessage("第二条");
		expect(useTrainingStore.getState().beginCorrection(studentId, "修正")).toBeNull();
	});

	it("beginCorrection returns snapshot and replaces content", () => {
		useTrainingStore.getState().addStudentMessage("原话");
		const sid = getTrainingState().messages[0].id as string;
		const snapshot = useTrainingStore.getState().beginCorrection(sid, "新话");
		expect(snapshot).not.toBeNull();
		expect(getTrainingState().messages[0].content).toBe("新话");
		expect(getTrainingState().messages[1].streaming).toBe(true);
	});

	it("rollbackCorrection restores original messages", () => {
		useTrainingStore.getState().addStudentMessage("原话");
		const sid = getTrainingState().messages[0].id as string;
		const snapshot = useTrainingStore.getState().beginCorrection(sid, "新话");
		useTrainingStore.getState().rollbackCorrection(snapshot!);
		expect(getTrainingState().messages[0].content).toBe("原话");
	});

	it("finalizeCorrection assigns server ids and updates recordDetail", () => {
		useTrainingStore.setState({
			recordDetail: { message_correction: { used: 0, remaining: 3, eligible_last_message_id: null } },
		});
		useTrainingStore.getState().addStudentMessage("原话");
		const sid = getTrainingState().messages[0].id as string;
		const snapshot = useTrainingStore.getState().beginCorrection(sid, "新话")!;
		useTrainingStore
			.getState()
			.finalizeCorrection(snapshot, { student_id: 101, patient_id: 202, corrections_used: 1, corrections_remaining: 2 });
		const s = getTrainingState();
		expect(s.messages[0].id).toBe("101");
		expect(s.messages[1].id).toBe("202");
		expect(s.messages[1].streaming).toBe(false);
		expect(s.recordDetail?.message_correction).toMatchObject({
			used: 1,
			remaining: 2,
			eligible_last_message_id: 101,
		});
		expect(s.sending).toBe(false);
	});
});

describe("mergeHistory", () => {
	it("dedupes by id and content", () => {
		useTrainingStore.getState().addStudentMessage("已有");
		const { messages } = getTrainingState();
		const sid = messages[0].id as string;
		const pid = messages[1].id as string;
		useTrainingStore.getState().finalizeMessage(pid, 1);

		const added = useTrainingStore.getState().mergeHistory([
			{ id: sid, role: "student", content: "已有" }, // dup by id
			{ role: "student", content: "已有" }, // dup by content
			{ id: 999, role: "patient", content: "新的回复" },
		]);
		expect(added).toBe(1);
		expect(getTrainingState().messages).toHaveLength(3);
	});

	it("returns 0 for empty or fully-duplicate history", () => {
		expect(useTrainingStore.getState().mergeHistory([])).toBe(0);
		useTrainingStore.getState().addStudentMessage("x");
		const sid = getTrainingState().messages[0].id as string;
		expect(useTrainingStore.getState().mergeHistory([{ id: sid, role: "student", content: "x" }])).toBe(0);
	});
});

describe("emotion labels and styling", () => {
	it("label maps cover all emotion states", () => {
		expect(Object.keys(EMOTION_LABELS)).toHaveLength(6);
		expect(EMOTION_LABELS.neutral).toBe("正常配合");
	});

	it("4d labels cover all keys", () => {
		expect(EMOTION_4D_LABELS.open_trusting).toBe("开放信任");
		expect(Object.keys(EMOTION_4D_LABELS)).toHaveLength(9);
	});

	it("getEmotionBorder falls back to neutral", () => {
		expect(getEmotionBorder("withdrawn")).toBe("var(--mantine-color-red-4)");
		expect(getEmotionBorder("open_trusting")).toBe("var(--mantine-color-green-4)");
		expect(getEmotionBorder("unknown")).toBe("var(--mantine-color-gray-4)");
	});

	it("getEmotionColor falls back to neutral", () => {
		expect(getEmotionColor("neutral")).toBe("var(--mantine-color-dimmed)");
		expect(getEmotionColor("weird")).toBe("var(--mantine-color-dimmed)");
	});

	it("setEmotion4D updates all four dimensions", () => {
		useTrainingStore.getState().setEmotion4D(80, 20, 10, 70, "open_trusting");
		const s = getTrainingState();
		expect(s.trust).toBe(80);
		expect(s.anxiety).toBe(20);
		expect(s.irritation).toBe(10);
		expect(s.cooperation).toBe(70);
		expect(s.emotion4D).toBe("open_trusting");
	});

	it("toggleTts flips flag", () => {
		useTrainingStore.getState().setTtsAutoPlay(true);
		useTrainingStore.getState().toggleTts();
		expect(getTrainingState().ttsAutoPlay).toBe(false);
	});
});
