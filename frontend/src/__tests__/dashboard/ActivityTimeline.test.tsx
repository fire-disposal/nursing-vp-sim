import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	ActivityTimeline,
	type ActivityEvent,
} from "@/components/dashboard/ActivityTimeline";

const mockEvents: ActivityEvent[] = [
	{
		id: "1",
		time: "14:32",
		studentName: "李同学",
		action: "完成了 糖尿病护理",
		meta: "85分",
		metaColor: "green",
	},
	{
		id: "2",
		time: "13:15",
		studentName: "王同学",
		action: "开始了 心衰评估",
	},
];

describe("ActivityTimeline", () => {
	it("renders events in order", () => {
		render(<ActivityTimeline events={mockEvents} />);
		const times = screen.getAllByText(/^\d{2}:\d{2}$/);
		expect(times[0]).toHaveTextContent("14:32");
		expect(times[1]).toHaveTextContent("13:15");
	});

	it("renders student names and actions", () => {
		render(<ActivityTimeline events={mockEvents} />);
		expect(screen.getByText(/李同学/)).toBeInTheDocument();
		expect(screen.getByText(/完成了 糖尿病护理/)).toBeInTheDocument();
	});

	it("renders meta badge when provided", () => {
		render(<ActivityTimeline events={mockEvents} />);
		expect(screen.getByText("85分")).toBeInTheDocument();
	});

	it("renders empty state when no events", () => {
		render(<ActivityTimeline events={[]} />);
		expect(screen.getByText("暂无最近动态")).toBeInTheDocument();
	});
});
