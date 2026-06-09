export interface User {
  user_id: number;
  username?: string;
  role: string;
  role_display_name: string;
  display_name: string;
  gender?: string | null;
  avatar?: string | null;
  grade?: string;
  className?: string;
  school_id?: number;
  school_name?: string;
}

export interface School {
  id: number;
  name: string;
  teacher_count: number;
  student_count: number;
  created_at: string;
}

export interface RoleItem {
  id: number;
  name: string;
  display_name: string;
  is_system: boolean;
  school_id: number | null;
  permissions: string[];
  user_count: number;
}

export interface Grade {
  id: number;
  name: string;
  class_count?: number;
  student_count?: number;
  created_at?: string;
}

export interface ClassItem {
  id: number;
  name: string;
  grade_id: number;
  grade_name?: string;
  student_count?: number;
  created_at?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<User>;
  refreshUser: () => Promise<void>;
  logout: () => void;
  permissions: string[];
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
