import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { FeedbackProvider } from "../components/FeedbackProvider";
import Layout from "../components/Layout";
import { ToastProvider } from "../components/Toast";

const mockUseAuthStore = vi.fn();
vi.mock("../stores/authStore", () => ({
  default: (selector) => selector(mockUseAuthStore()),
}));

function renderLayout(user, initialRoute = "/home") {
  mockUseAuthStore.mockReturnValue({ user, token: "test-token", logout: vi.fn() });

  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <ToastProvider>
        <FeedbackProvider>
          <Layout>
            <div data-testid="child">Content</div>
          </Layout>
        </FeedbackProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  const studentUser = {
    id: 1,
    username: "s1",
    display_name: "李明",
    role: "student",
    user_id: 1,
  };

  const teacherUser = {
    id: 2,
    username: "t1",
    display_name: "张老师",
    role: "teacher",
    user_id: 2,
  };

  it("renders children content", () => {
    renderLayout(studentUser);
    expect(screen.getByTestId("child")).toHaveTextContent("Content");
  });

  it("shows brand title", () => {
    renderLayout(studentUser);
    expect(screen.getByText("虚拟患者系统")).toBeInTheDocument();
  });

  it("shows user display name", () => {
    renderLayout(studentUser);
    expect(screen.getByText("李明")).toBeInTheDocument();
  });

  it("shows student role label", () => {
    renderLayout(studentUser);
    expect(screen.getByText("学生")).toBeInTheDocument();
  });

  it("shows teacher role label", () => {
    renderLayout(teacherUser);
    expect(screen.getByText("教师")).toBeInTheDocument();
  });

  it("shows student navigation links", () => {
    renderLayout(studentUser);
    expect(screen.getByText("病例训练")).toBeInTheDocument();
    expect(screen.queryByText("训练管理")).not.toBeInTheDocument();
  });

  it("shows teacher navigation links", () => {
    renderLayout(teacherUser);
    expect(screen.getByText("训练管理")).toBeInTheDocument();
    expect(screen.queryByText("病例训练")).not.toBeInTheDocument();
  });

  it("has logout button", () => {
    renderLayout(studentUser);
    expect(screen.getByText("退出登录")).toBeInTheDocument();
  });

  it("highlights active nav link", () => {
    renderLayout(studentUser, "/history");
    const historyLinks = screen.getAllByText("训练记录");
    expect(historyLinks.length).toBeGreaterThanOrEqual(1);
  });
});
