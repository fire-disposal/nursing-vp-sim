import { render, screen } from "@/__tests__/render";
import { beforeEach, describe, expect, it } from "vitest";
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
		useTrainingStore.setState({
			recordDetail: {
				exam_results: [
					{ type: "hr", label: "心率", value: "94.0", unit: "次/分", status: "normal" },
				],
			},
		});

		render(
			<ChatDisplay
				messages={[]}
				patient={PATIENT}
				bus={createMessageBus()}
			/>,
		);

		expect(screen.getByText("心率")).toBeInTheDocument();
		expect(screen.getByText("94.0")).toBeInTheDocument();
		expect(screen.getByText("次/分")).toBeInTheDocument();
	});
});
