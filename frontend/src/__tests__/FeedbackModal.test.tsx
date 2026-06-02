import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackProvider, useFeedback } from "../components/FeedbackProvider";
import { ToastProvider } from "../components/Toast";

vi.mock("../api", () => ({
  submitFeedback: vi.fn().mockResolvedValue({ data: { id: 1 } }),
}));

function FeedbackTester() {
  const { openFeedback } = useFeedback();
  return <button onClick={openFeedback}>Open Feedback</button>;
}

function renderFeedback() {
  return render(
    <ToastProvider>
      <FeedbackProvider>
        <FeedbackTester />
      </FeedbackProvider>
    </ToastProvider>,
  );
}

describe("FeedbackModal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens modal when triggered via context", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByText("Open Feedback"));
    expect(screen.getByText("意见反馈")).toBeInTheDocument();
  });

  it("shows all 5 emotion buttons", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByText("Open Feedback"));
    expect(screen.getByText("很差")).toBeInTheDocument();
    expect(screen.getByText("较差")).toBeInTheDocument();
    expect(screen.getByText("一般")).toBeInTheDocument();
    expect(screen.getByText("满意")).toBeInTheDocument();
    expect(screen.getByText("很满意")).toBeInTheDocument();
  });

  it("shows all 6 tag chips", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByText("Open Feedback"));
    expect(screen.getByText("功能建议")).toBeInTheDocument();
    expect(screen.getByText("BUG反馈")).toBeInTheDocument();
    expect(screen.getByText("体验评价")).toBeInTheDocument();
    expect(screen.getByText("内容质量")).toBeInTheDocument();
    expect(screen.getByText("界面设计")).toBeInTheDocument();
    expect(screen.getByText("其他")).toBeInTheDocument();
  });

  it("submit button is disabled when no rating selected", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByText("Open Feedback"));
    const submitBtn = screen.getByText("提交");
    expect(submitBtn).toBeDisabled();
  });

  it("submit button becomes enabled after selecting rating and tag", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByText("Open Feedback"));
    await user.click(screen.getByText("满意"));
    await user.click(screen.getByText("功能建议"));

    const submitBtn = screen.getByText("提交");
    expect(submitBtn).not.toBeDisabled();
  });

  it("closes modal on cancel click", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByText("Open Feedback"));
    expect(screen.getByText("意见反馈")).toBeInTheDocument();

    await user.click(screen.getByText("取消"));
    expect(screen.queryByText("意见反馈")).not.toBeInTheDocument();
  });

  it("resets state on close", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByText("Open Feedback"));
    await user.click(screen.getByText("满意"));
    await user.click(screen.getByText("功能建议"));

    await user.click(screen.getByText("取消"));

    // Reopen
    await user.click(screen.getByText("Open Feedback"));
    // Submit should be disabled again (no rating selected)
    expect(screen.getByText("提交")).toBeDisabled();
  });

  it("has textarea for optional content", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByText("Open Feedback"));
    const textarea = screen.getByPlaceholderText("请详细描述你的想法...");
    expect(textarea).toBeInTheDocument();

    await user.type(textarea, "这是一个测试反馈");
    expect(textarea).toHaveValue("这是一个测试反馈");
  });
});
