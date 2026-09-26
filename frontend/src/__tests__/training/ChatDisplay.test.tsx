import { render, screen } from "@/__tests__/render";
import { beforeEach, describe, expect, it } from "vitest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import { ChatDisplay } from "@/components/training/ChatDisplay";
import { createMessageBus } from "@/engine/MessageBus";
import { useTrainingStore } from "@/stores/trainingStore";

const PATIENT = {
	name: "王建国",
	age: 68,
	gender: "male" as const,
	caseTitle: "慢阻肺",
};

beforeEach(() => {
	useTrainingStore.getState().reset();
});

describe("ChatDisplay persisted exam results", () => {
	it("renders physical-exam cards restored from the record detail", () => {
		render(
			withTrainingData(
				<ChatDisplay messages={[]} patient={PATIENT} bus={createMessageBus()} />,
				makeRecord({
					exam_results: [
						{ type: "hr", label: "心率", value: "94.0", unit: "次/分", status: "normal" },
					],
				}),
			),
		);

		expect(screen.getByText("心率")).toBeInTheDocument();
		expect(screen.getByText("94.0")).toBeInTheDocument();
		expect(screen.getByText("次/分")).toBeInTheDocument();
	});
});

describe("修正入口", () => {
	it("乐观修正后的额度立即生效，无需等待 record refetch", () => {
		useTrainingStore.setState({
			messageCorrection: { used: 1, remaining: 2, eligible_last_message_id: 101 },
		});

		render(
			withTrainingData(
				<ChatDisplay
					messages={[{ id: "101", role: "student", content: "请问胸闷多久了" }]}
					patient={PATIENT}
					bus={createMessageBus()}
				/>,
				makeRecord(),
			),
		);

		expect(screen.getByText("修正 · 剩余 2")).toBeInTheDocument();
	});
});
