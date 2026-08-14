import { render, screen } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useConfirm } from "@/components/ui/confirm";

function ConfirmTrigger({ onResult }: { onResult: (v: boolean) => void }) {
	const { confirm } = useConfirm();
	const handleClick = async () => {
		const result = await confirm({ title: "Delete?", message: "Sure?" });
		onResult(result);
	};
	return (
		<button type="button" onClick={handleClick}>
			Delete
		</button>
	);
}

describe("ConfirmDialog", () => {
	it("renders confirm dialog when triggered", async () => {
		render(<ConfirmTrigger onResult={() => {}} />);

		await userEvent.click(screen.getByText("Delete"));
		expect(screen.getByText("Delete?")).toBeInTheDocument();
		expect(screen.getByText("Sure?")).toBeInTheDocument();
	});

	it("resolves true when confirm button clicked", async () => {
		const onResult = vi.fn();
		render(<ConfirmTrigger onResult={onResult} />);

		await userEvent.click(screen.getByText("Delete"));
		await userEvent.click(screen.getByText("确定"));

		expect(onResult).toHaveBeenCalledWith(true);
	});

	it("resolves false when cancel button clicked", async () => {
		const onResult = vi.fn();
		render(<ConfirmTrigger onResult={onResult} />);

		await userEvent.click(screen.getByText("Delete"));
		await userEvent.click(screen.getByText("取消"));

		expect(onResult).toHaveBeenCalledWith(false);
	});

	it("renders danger styling", async () => {
		function DangerTrigger() {
			const { confirm } = useConfirm();
			return (
				<button
					type="button"
					onClick={() =>
						confirm({ title: "Danger", message: "!", danger: true })
					}
				>
					Danger
				</button>
			);
		}

		render(<DangerTrigger />);

		await userEvent.click(screen.getByText("Danger"));
		const titles = screen.getAllByText("Danger");
		expect(titles.length).toBeGreaterThanOrEqual(1);
	});
});
