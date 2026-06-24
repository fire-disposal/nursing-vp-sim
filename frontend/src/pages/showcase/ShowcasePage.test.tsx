import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import ShowcasePage from "./ShowcasePage";

describe("ShowcasePage", () => {
	it("renders hero title and a CTA linking to /login", () => {
		render(
			<MemoryRouter>
				<ShowcasePage />
			</MemoryRouter>,
		);
		expect(
			screen.getByRole("heading", { level: 1, name: /虚拟患者/ }),
		).toBeInTheDocument();
		const ctas = screen.getAllByRole("link", { name: "进入系统" });
		expect(ctas.length).toBeGreaterThan(0);
		expect(ctas[0]).toHaveAttribute("href", "/login");
	});
});
