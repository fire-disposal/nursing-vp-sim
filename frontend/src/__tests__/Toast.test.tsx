import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useToast } from "@/components/Toast";
import { Toaster } from "@/components/ui/sonner";

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
      <>
        <Toaster />
        <ToastTrigger message="Hello World" />
      </>,
    );

    await userEvent.click(screen.getByText("Show"));
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("renders success toast", async () => {
    render(
      <>
        <Toaster />
        <ToastTrigger message="Success!" type="success" />
      </>,
    );

    await userEvent.click(screen.getByText("Show"));
    expect(screen.getByText("Success!")).toBeInTheDocument();
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

    render(
      <>
        <Toaster />
        <QuickToast />
      </>,
    );

    await userEvent.click(screen.getByText("Success"));
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
});
