import { create } from "zustand";
import useAuthStore from "./authStore";

interface SchoolState {
  selectedSchoolId: number | null;
  setSelectedSchool: (id: number | null) => void;
  getEffectiveSchoolId: () => number | null;
  isSuperAdmin: () => boolean;
  getSchoolName: () => string | undefined;
}

const useSchoolStore = create<SchoolState>((set, get) => ({
  selectedSchoolId: null,

  setSelectedSchool: (id: number | null) => set({ selectedSchoolId: id }),

  getEffectiveSchoolId: () => {
    const user = useAuthStore.getState().user;
    if (!user) return null;
    if (user.school_id != null) return user.school_id;
    return get().selectedSchoolId;
  },

  isSuperAdmin: () => {
    const user = useAuthStore.getState().user;
    return user != null && user.school_id == null && user.role === "super_admin";
  },

  getSchoolName: () => {
    const user = useAuthStore.getState().user;
    if (!user) return undefined;
    if (user.school_id != null) return user.school_name;
    return get().selectedSchoolId != null ? undefined : undefined;
  },
}));

export default useSchoolStore;
