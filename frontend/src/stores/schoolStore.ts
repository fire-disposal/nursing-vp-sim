import { create } from "zustand";
import useAuthStore from "./authStore";

interface SchoolState {
  getEffectiveSchoolId: () => number | null;
}

const useSchoolStore = create<SchoolState>(() => ({
  getEffectiveSchoolId: () => {
    const user = useAuthStore.getState().user;
    if (!user) return null;
    return user.school_id ?? null;
  },
}));

export default useSchoolStore;
