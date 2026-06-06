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

  it("initializes with null selectedSchoolId", async () => {
    mockGetState.mockReturnValue({ user: null });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().selectedSchoolId).toBeNull();
  });

  it("setSelectedSchool updates selectedSchoolId", async () => {
    mockGetState.mockReturnValue({ user: null });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    useSchoolStore.getState().setSelectedSchool(5);
    expect(useSchoolStore.getState().selectedSchoolId).toBe(5);
    useSchoolStore.getState().setSelectedSchool(null);
    expect(useSchoolStore.getState().selectedSchoolId).toBeNull();
  });

  it("getEffectiveSchoolId returns school_id from user when available", async () => {
    mockGetState.mockReturnValue({
      user: { user_id: 1, role: "teacher", role_display_name: "Teacher", display_name: "T", school_id: 10 },
    });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().getEffectiveSchoolId()).toBe(10);
  });

  it("getEffectiveSchoolId returns selectedSchoolId when user has no school", async () => {
    mockGetState.mockReturnValue({
      user: { user_id: 1, role: "student", role_display_name: "Student", display_name: "S" },
    });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    useSchoolStore.getState().setSelectedSchool(7);
    expect(useSchoolStore.getState().getEffectiveSchoolId()).toBe(7);
  });

  it("getEffectiveSchoolId returns null when no user and no selection", async () => {
    mockGetState.mockReturnValue({ user: null });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().getEffectiveSchoolId()).toBeNull();
  });

  it("isSuperAdmin returns false for student", async () => {
    mockGetState.mockReturnValue({
      user: { user_id: 1, role: "student", role_display_name: "Student", display_name: "S" },
    });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().isSuperAdmin()).toBe(false);
  });

  it("isSuperAdmin returns false for regular teacher", async () => {
    mockGetState.mockReturnValue({
      user: { user_id: 1, role: "teacher", role_display_name: "Teacher", display_name: "T", school_id: 5 },
    });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().isSuperAdmin()).toBe(false);
  });

  it("isSuperAdmin returns true for super_admin with no school_id", async () => {
    mockGetState.mockReturnValue({
      user: { user_id: 1, role: "super_admin", role_display_name: "Super Admin", display_name: "SA" },
    });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().isSuperAdmin()).toBe(true);
  });

  it("getSchoolName returns user's school_name when user has school_id", async () => {
    mockGetState.mockReturnValue({
      user: {
        user_id: 1,
        role: "teacher",
        role_display_name: "Teacher",
        display_name: "T",
        school_id: 3,
        school_name: "Test School",
      },
    });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().getSchoolName()).toBe("Test School");
  });

  it("getSchoolName returns undefined when no user", async () => {
    mockGetState.mockReturnValue({ user: null });
    const { default: useSchoolStore } = await import("@/stores/schoolStore");
    expect(useSchoolStore.getState().getSchoolName()).toBeUndefined();
  });
});
