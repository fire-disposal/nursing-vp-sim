import type { User, Grade, ClassItem } from "./models";

export interface AuthState {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<User>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

export interface GradesClassesState {
  grades: Grade[];
  classes: ClassItem[];
  loading: boolean;
  fetchGrades: () => Promise<void>;
  createGrade: (name: string) => Promise<Grade>;
  updateGrade: (id: number, name: string) => Promise<Grade>;
  deleteGrade: (id: number) => Promise<void>;
  fetchClasses: (gradeId?: number) => Promise<ClassItem[]>;
  createClass: (gradeId: number, name: string) => Promise<ClassItem>;
  updateClass: (id: number, body: Partial<ClassItem>) => Promise<ClassItem>;
  deleteClass: (id: number) => Promise<void>;
}

export interface LLMState {
  tab: string;
  setTab: (tab: string) => void;
}
