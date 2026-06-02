import { create } from "zustand";
import { getGrades, createGrade, updateGrade, deleteGrade, getClasses, createClass, updateClass, deleteClass } from "../api";

const useGradesClassesStore = create((set, get) => ({
  grades: [],
  classes: [],
  loading: false,

  fetchGrades: async () => {
    const { grades, loading } = get();
    if (loading) return;
    set({ loading: true });
    try {
      const data = await getGrades();
      set({ grades: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createGrade: async (name) => {
    const data = await createGrade({ name });
    set((s) => ({ grades: [...s.grades, data] }));
    return data;
  },

  updateGrade: async (id, name) => {
    const data = await updateGrade(id, { name });
    set((s) => ({ grades: s.grades.map((g) => (g.id === id ? data : g)) }));
    return data;
  },

  deleteGrade: async (id) => {
    await deleteGrade(id);
    set((s) => ({ grades: s.grades.filter((g) => g.id !== id), classes: [] }));
  },

  fetchClasses: async (gradeId) => {
    try {
      const params = gradeId ? { grade_id: gradeId } : {};
      const data = await getClasses(params);
      set({ classes: data });
      return data;
    } catch {
      return [];
    }
  },

  createClass: async (gradeId, name) => {
    const data = await createClass({ grade_id: gradeId, name });
    set((s) => ({ classes: [...s.classes, data] }));
    return data;
  },

  updateClass: async (id, body) => {
    const data = await updateClass(id, body);
    set((s) => ({ classes: s.classes.map((c) => (c.id === id ? data : c)) }));
    return data;
  },

  deleteClass: async (id) => {
    await deleteClass(id);
    set((s) => ({ classes: s.classes.filter((c) => c.id !== id) }));
  },
}));

export default useGradesClassesStore;
