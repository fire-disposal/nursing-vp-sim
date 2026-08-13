import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useToast } from "@/components/Toast";

function renderWithProvider(ui: ReactNode) {
	return render(<MantineProvider>{ui}</MantineProvider>);
}

function ToastTrigger({
	message = "test",
	type = "info" as const,
	duration = 0,
}: {
	message?: string;
	type?: "success" | "error" | "warning" | "info";
	duration?: number;
}) {
	const toast = useToast();
	return (
		<button type="button" onClick={() => toast.toast(message, type, duration)}>
			Show
		</button>
	);
}

describe("Toast", () => {
	it("renders toast when triggered", async () => {
		renderWithProvider(
			<>
				<Notifications />
				<ToastTrigger message="Hello World" />
			</>,
		);

		await userEvent.click(screen.getByText("Show"));
		expect(await screen.findByText("Hello World")).toBeInTheDocument();
	});

	it("renders success toast", async () => {
		renderWithProvider(
			<>
				<Notifications />
				<ToastTrigger message="Success!" type="success" />
			</>,
		);

		await userEvent.click(screen.getByText("Show"));
		expect(await screen.findByText("Success!")).toBeInTheDocument();
	});

	it("convenience methods work", async () => {
		function QuickToast() {
			const t = useToast();
			return (
				<button type="button" onClick={() => t.success("Done")}>
					Success
				</button>
			);
		}

		renderWithProvider(
			<>
				<Notifications />
				<QuickToast />
			</>,
		);

		await userEvent.click(screen.getByText("Success"));
		expect(await screen.findByText("Done")).toBeInTheDocument();
	});
});
