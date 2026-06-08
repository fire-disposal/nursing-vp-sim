import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetState = vi.fn();

vi.mock("@/stores/authStore", () => ({
  default: { getState: mockGetState },
}));

describe("schoolStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("getEffectiveSchoolId returns school_id from user when available", async () => {
    mockGetState.mockReturnValue({
      user: { user_id: 1, role: "teacher", role_display_name: "Teacher", display_name: "T", school_id: 10 },
    });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().getEffectiveSchoolId()).toBe(10);
  });

  it("getEffectiveSchoolId returns null when user has no school_id", async () => {
    mockGetState.mockReturnValue({
      user: { user_id: 1, role: "student", role_display_name: "Student", display_name: "S" },
    });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().getEffectiveSchoolId()).toBeNull();
  });

  it("getEffectiveSchoolId returns null when no user", async () => {
    mockGetState.mockReturnValue({ user: null });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().getEffectiveSchoolId()).toBeNull();
  });
});
