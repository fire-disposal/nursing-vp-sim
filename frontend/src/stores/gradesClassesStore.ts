import { create } from "zustand";
import {
	createClass,
	createGrade,
	deleteClass,
	deleteGrade,
	getClasses,
	getGrades,
	updateClass,
	updateGrade,
} from "@/api";
import type { ClassItem, Grade, GradesClassesState } from "../types/store";

const useGradesClassesStore = create<GradesClassesState>((set, get) => ({
	grades: [] as Grade[],
	classes: [] as ClassItem[],
	loading: false,
	_pendingFetch: null as Promise<void> | null,

	fetchGrades: async (): Promise<void> => {
		const existing = get()._pendingFetch;
		if (existing) return existing;
		set({ loading: true });
		const promise = (async () => {
			try {
				const { data } = await getGrades();
				set({ grades: data, loading: false, _pendingFetch: null });
			} catch {
				set({ loading: false, _pendingFetch: null });
			}
		})();
		set({ _pendingFetch: promise });
		return promise;
	},

	createGrade: async (name: string): Promise<Grade> => {
		const { data } = await createGrade({ name });
		set((s) => ({ grades: [...(s.grades ?? []), data] }));
		return data;
	},

	updateGrade: async (id: number, name: string): Promise<Grade> => {
		const { data } = await updateGrade(id, { name });
		set((s) => ({ grades: (s.grades ?? []).map((g) => (g.id === id ? data : g)) }));
		return data;
	},

	deleteGrade: async (id: number): Promise<void> => {
		await deleteGrade(id);
		set((s) => ({ grades: (s.grades ?? []).filter((g) => g.id !== id), classes: [] }));
	},

	fetchClasses: async (gradeId?: number): Promise<ClassItem[]> => {
		try {
			const params = gradeId ? { grade_id: gradeId } : {};
			const { data } = await getClasses(params);
			set({ classes: data ?? [] });
			return data;
		} catch {
			return [];
		}
	},

	createClass: async (gradeId: number, name: string): Promise<ClassItem> => {
		const { data } = await createClass({ grade_id: gradeId, name });
		set((s) => ({ classes: [...(s.classes ?? []), data] }));
		return data;
	},

	updateClass: async (
		id: number,
		body: Partial<ClassItem>,
	): Promise<ClassItem> => {
		const { data } = await updateClass(id, body);
		set((s) => ({ classes: (s.classes ?? []).map((c) => (c.id === id ? data : c)) }));
		return data;
	},

	deleteClass: async (id: number): Promise<void> => {
		await deleteClass(id);
		set((s) => ({ classes: (s.classes ?? []).filter((c) => c.id !== id) }));
	},
}));

export default useGradesClassesStore;
