import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import type { ClassItem, Grade } from "@/types/store";
import type { EditUserFormValues, RoleOption, UserBrief, UserFormValues } from "./types";

interface UserFormProps {
  open: boolean;
  user: UserBrief | null;
  roles: RoleOption[];
  grades: Grade[];
  getClassesForGrade: (gradeId: string) => Promise<ClassItem[]>;
  onClose: () => void;
  onSaveRegister: (values: UserFormValues) => void;
  onSaveEdit: (values: EditUserFormValues) => void;
  registerMsg: string;
  editUserMsg: string;
  isSaving: boolean;
}

const inputClass =
  "w-full h-10 px-3 border border-border rounded-lg bg-muted text-foreground text-sm focus:outline-none focus:border-blue-500 focus:bg-card focus:ring-2 focus:ring-blue-500/10";

const selectClass =
  "w-full h-10 px-3 border border-border rounded-lg bg-muted text-foreground text-sm focus:outline-none focus:border-blue-500 focus:bg-card focus:ring-2 focus:ring-blue-500/10";

const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-blue-700 transition-colors border-none cursor-pointer";

const btnSecondary =
  "inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors border-none cursor-pointer";

const emptyRegForm: UserFormValues = { username: "", password: "", role: "student", display_name: "", student_id: "", class_id: "" };

export default function UserForm({
  open,
  user,
  roles,
  grades,
  getClassesForGrade,
  onClose,
  onSaveRegister,
  onSaveEdit,
  registerMsg,
  editUserMsg,
  isSaving,
}: UserFormProps) {
  const isEdit = user !== null;

  const [regForm, setRegForm] = useState<UserFormValues>(emptyRegForm);
  const [regGrade, setRegGrade] = useState("");
  const [regClasses, setRegClasses] = useState<ClassItem[]>([]);

  const [editForm, setEditForm] = useState<EditUserFormValues>({ display_name: "", student_id: "", role: "", password: "", class_id: "" });
  const [editGrade, setEditGrade] = useState("");
  const [editClasses, setEditClasses] = useState<ClassItem[]>([]);

  useEffect(() => {
    if (open && user) {
      setEditForm({
        display_name: user.display_name,
        student_id: user.student_id || "",
        role: user.role,
        password: "",
        class_id: user.class_id != null ? String(user.class_id) : "",
      });
      if (user.class_id) {
        loadEditClassesForGrade(user);
      } else {
        setEditGrade("");
        setEditClasses([]);
      }
    }
  }, [open, user]);

  useEffect(() => {
    if (!open) {
      setRegForm(emptyRegForm);
      setRegGrade("");
      setRegClasses([]);
    }
  }, [open]);

  async function loadEditClassesForGrade(u: UserBrief) {
    try {
      const allClasses = await getClassesForGrade("");
      const found = allClasses.find((c) => c.id === u.class_id);
      if (found) {
        setEditGrade(String(found.grade_id));
        const classes = await getClassesForGrade(String(found.grade_id));
        setEditClasses(classes);
      }
    } catch {
      setEditGrade("");
      setEditClasses([]);
    }
  }

  async function handleRegGradeChange(gradeId: string) {
    setRegGrade(gradeId);
    setRegForm((f) => ({ ...f, class_id: "" }));
    if (gradeId) {
      try {
        const classes = await getClassesForGrade(gradeId);
        setRegClasses(classes);
      } catch {
        setRegClasses([]);
      }
    } else {
      setRegClasses([]);
    }
  }

  async function handleEditGradeChange(gradeId: string) {
    setEditGrade(gradeId);
    setEditForm((f) => ({ ...f, class_id: "" }));
    if (gradeId) {
      try {
        const classes = await getClassesForGrade(gradeId);
        setEditClasses(classes);
      } catch {
        setEditClasses([]);
      }
    } else {
      setEditClasses([]);
    }
  }

  function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSaveRegister(regForm);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSaveEdit(editForm);
  }

  if (isEdit) {
    return (
      <Modal open={open} onClose={onClose} title={`编辑用户: ${user?.display_name}`} maxWidth={480}>
        {editUserMsg && <div className="bg-destructive/10 text-red-500 px-3.5 py-2.5 rounded-lg text-sm mb-4 text-left">{editUserMsg}</div>}
        <form onSubmit={handleEditSubmit}>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">姓名</label>
            <input
              className={inputClass}
              value={editForm.display_name}
              onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">学号</label>
            <input className={inputClass} value={editForm.student_id} onChange={(e) => setEditForm((f) => ({ ...f, student_id: e.target.value }))} />
          </div>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">角色</label>
            <select className={selectClass} value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}>
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">年级</label>
            <select className={selectClass} value={editGrade} onChange={(e) => handleEditGradeChange(e.target.value)}>
              <option value="">不指定</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">班级</label>
            <select
              className={selectClass}
              value={editForm.class_id}
              onChange={(e) => setEditForm((f) => ({ ...f, class_id: e.target.value }))}
              disabled={!editGrade}
            >
              <option value="">不指定</option>
              {editClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">新密码（留空不修改）</label>
            <input
              type="password"
              className={inputClass}
              value={editForm.password}
              onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="至少6位"
              minLength={6}
            />
          </div>
          <div className="flex gap-3 justify-end mt-4">
            <button type="button" className={btnSecondary} onClick={onClose}>
              取消
            </button>
            <button type="submit" className={btnPrimary} disabled={isSaving}>
              {isSaving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="添加用户" maxWidth={780}>
      {registerMsg && (
        <div
          className={cn(
            "px-3.5 py-2.5 rounded-lg text-sm mb-4 text-left",
            registerMsg.includes("成功") ? "bg-green-50 text-green-600" : "bg-destructive/10 text-red-500",
          )}
        >
          {registerMsg}
        </div>
      )}
      <form onSubmit={handleRegisterSubmit} className="flex gap-3 flex-wrap items-end">
        <div className="flex-[1_1_120px]">
          <label className="block text-xs text-muted-foreground font-semibold mb-1">用户名</label>
          <input value={regForm.username} onChange={(e) => setRegForm({ ...regForm, username: e.target.value })} required className={inputClass} />
        </div>
        <div className="flex-[1_1_120px]">
          <label className="block text-xs text-muted-foreground font-semibold mb-1">密码</label>
          <input
            type="password"
            value={regForm.password}
            onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
            required
            minLength={6}
            placeholder="至少6位"
            className={inputClass}
          />
        </div>
        <div className="flex-[1_1_100px]">
          <label className="block text-xs text-muted-foreground font-semibold mb-1">角色</label>
          <select value={regForm.role} onChange={(e) => setRegForm({ ...regForm, role: e.target.value })} className={selectClass}>
            {roles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-[1_1_120px]">
          <label className="block text-xs text-muted-foreground font-semibold mb-1">姓名</label>
          <input value={regForm.display_name} onChange={(e) => setRegForm({ ...regForm, display_name: e.target.value })} required className={inputClass} />
        </div>
        <div className="flex-[1_1_100px]">
          <label className="block text-xs text-muted-foreground font-semibold mb-1">学号</label>
          <input value={regForm.student_id} onChange={(e) => setRegForm({ ...regForm, student_id: e.target.value })} className={inputClass} />
        </div>
        <div className="flex-[1_1_120px]">
          <label className="block text-xs text-muted-foreground font-semibold mb-1">年级</label>
          <select value={regGrade} onChange={(e) => handleRegGradeChange(e.target.value)} className={selectClass}>
            <option value="">不指定</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-[1_1_120px]">
          <label className="block text-xs text-muted-foreground font-semibold mb-1">班级</label>
          <select value={regForm.class_id} onChange={(e) => setRegForm({ ...regForm, class_id: e.target.value })} disabled={!regGrade} className={selectClass}>
            <option value="">不指定</option>
            {regClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={isSaving} className={cn(btnPrimary, "h-10")}>
          {isSaving ? "注册中..." : "注册"}
        </button>
      </form>
    </Modal>
  );
}
