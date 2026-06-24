import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ScreenshotPlaceholder from "./ScreenshotPlaceholder";

describe("ScreenshotPlaceholder", () => {
	it("renders dimension text when no id is provided", () => {
		render(<ScreenshotPlaceholder width={1440} height={900} />);
		expect(screen.getByText("1440×900")).toBeInTheDocument();
	});

	it("reserves aspect ratio to avoid CLS", () => {
		const { container } = render(
			<ScreenshotPlaceholder width={1600} height={1000} />,
		);
		const box = container.firstChild as HTMLElement;
		expect(box.style.aspectRatio).toBe("1600 / 1000");
	});
});
