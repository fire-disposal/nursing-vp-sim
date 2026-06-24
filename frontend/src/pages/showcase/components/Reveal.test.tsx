import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Reveal from "./Reveal";

describe("Reveal", () => {
	it("always renders children (IntersectionObserver absent in jsdom → visible fallback)", () => {
		render(
			<Reveal>
				<p>可见内容</p>
			</Reveal>,
		);
		expect(screen.getByText("可见内容")).toBeInTheDocument();
	});
});
