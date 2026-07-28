import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CTA_LABEL, HERO_TITLE } from "./data";
import ShowcasePage from "./ShowcasePage";

describe("ShowcasePage", () => {
	it("renders hero title and a CTA linking to /login", () => {
		render(
			<MemoryRouter>
				<ShowcasePage />
			</MemoryRouter>,
		);
		expect(
			screen.getByRole("heading", { level: 1, name: HERO_TITLE }),
		).toBeInTheDocument();
		const ctas = screen.getAllByRole("link", { name: CTA_LABEL });
		expect(ctas.length).toBeGreaterThan(0);
		expect(ctas[0]).toHaveAttribute("href", "/login");
	});
});
