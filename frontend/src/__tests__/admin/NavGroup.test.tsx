import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home, Settings } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NavGroup } from "@/components/ui/nav-group";

describe("NavGroup", () => {
	it("renders label and icon", () => {
		render(
			<MemoryRouter>
				<NavGroup
					label="教学中心"
					icon={Home}
					defaultOpen
					storageKey="test"
				>
					<div>child content</div>
				</NavGroup>
			</MemoryRouter>,
		);
		expect(screen.getByText("教学中心")).toBeInTheDocument();
		expect(screen.getByText("child content")).toBeInTheDocument();
	});

	it("collapses and expands on click", async () => {
		render(
			<MemoryRouter>
				<NavGroup
					label="教学中心"
					icon={Home}
					defaultOpen
					storageKey="test-collapse"
				>
					<span data-testid="child">content</span>
				</NavGroup>
			</MemoryRouter>,
		);
		expect(screen.getByTestId("child")).toBeVisible();
		await userEvent.click(screen.getByText("教学中心"));
		expect(screen.queryByTestId("child")).not.toBeInTheDocument();
		await userEvent.click(screen.getByText("教学中心"));
		expect(screen.getByTestId("child")).toBeVisible();
	});

	it("renders collapsed when defaultOpen is false", () => {
		render(
			<MemoryRouter>
				<NavGroup
					label="系统运维"
					icon={Settings}
					defaultOpen={false}
					storageKey="test-closed"
				>
					<span data-testid="hidden-child">content</span>
				</NavGroup>
			</MemoryRouter>,
		);
		expect(screen.queryByTestId("hidden-child")).not.toBeInTheDocument();
	});

	it("renders nothing when children are empty", () => {
		const { container } = render(
			<MemoryRouter>
				<NavGroup
					label="空组"
					icon={Settings}
					defaultOpen
					storageKey="test-empty"
				>
					{null}
				</NavGroup>
			</MemoryRouter>,
		);
		expect(container.firstChild).toBeNull();
	});
});
