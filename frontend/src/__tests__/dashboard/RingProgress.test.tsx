import { render, screen } from "@/__tests__/render";
import { describe, expect, it } from "vitest";
import { RingProgress } from "@/pages/admin/dashboard/RingProgress";

describe("RingProgress", () => {
	it("renders percentage and label", () => {
		render(<RingProgress value={76} max={100} label="完成率" />);
		expect(screen.getByText("76%")).toBeInTheDocument();
		expect(screen.getByText("完成率")).toBeInTheDocument();
	});

	it("renders 0% when value is 0", () => {
		render(<RingProgress value={0} max={100} label="完成率" />);
		expect(screen.getByText("0%")).toBeInTheDocument();
	});

	it("renders 100% when value equals max", () => {
		render(<RingProgress value={50} max={50} label="完成率" />);
		expect(screen.getByText("100%")).toBeInTheDocument();
	});

	it("renders fraction subtitle", () => {
		render(
			<RingProgress
				value={15}
				max={20}
				label="完成率"
				subtitle="15人 / 20人"
			/>,
		);
		expect(screen.getByText("15人 / 20人")).toBeInTheDocument();
	});

	it("renders SVG circle", () => {
		const { container } = render(
			<RingProgress value={76} max={100} label="完成率" />,
		);
		const circles = container.querySelectorAll("circle");
		expect(circles.length).toBeGreaterThanOrEqual(2);
	});
});
