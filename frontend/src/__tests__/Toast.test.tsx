import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/Toast";

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
    render(
      <ToastProvider>
        <ToastTrigger message="Hello World" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByText("Show"));
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("renders success toast with correct styling", async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Success!" type="success" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByText("Show"));
    const toast = screen.getByText("Success!").closest(".toast");
    expect(toast).toHaveClass("toast-success");
  });

  it("removes toast when close button clicked", async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Deletable" duration={0} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByText("Show"));
    expect(screen.getByText("Deletable")).toBeInTheDocument();

    const closeBtn = document.querySelector(".toast-close") as HTMLElement;
    await userEvent.click(closeBtn);

    expect(screen.queryByText("Deletable")).not.toBeInTheDocument();
  });

  it("limits to max 5 toasts", async () => {
    function MultiToast() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            for (let i = 0; i < 10; i++) toast.toast(`Toast ${i}`, "info", 0);
          }}
        >
          Flood
        </button>
      );
    }

    render(
      <ToastProvider>
        <MultiToast />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByText("Flood"));
    const toasts = document.querySelectorAll(".toast");
    expect(toasts.length).toBeLessThanOrEqual(5);
  });

  it("throws error when useToast used outside provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ToastTrigger />)).toThrow("useToast must be inside ToastProvider");
    consoleError.mockRestore();
  });
});
