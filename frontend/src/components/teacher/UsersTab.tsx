import { AlertCircle, Download, Edit3, FileText, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { batchCreateUsers, deleteUser, getClasses, getGrades, getRoles, getUsers, register, updateUser } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";
import type { ClassItem, Grade } from "@/types/store";
import ClassFilter from "./ClassFilter";

type Schemas = components["schemas"];
type UserBrief = Schemas["UserBrief"];
type BatchCreateResult = Schemas["BatchCreateResult"];

interface BatchUser {
  username: string;
  password: string;
  display_name: string;
  role: string;
  student_id: string | null;
  class_id: number | null;
}

interface RegForm {
  username: string;
  password: string;
  role: string;
  display_name: string;
  student_id: string;
  class_id: string;
}

interface EditUserForm {
  display_name: string;
  student_id: string;
  role: string;
  password: string;
  class_id: string;
}

interface RoleOption {
  name: string;
  display_name: string;
}

interface ClassFilterParams {
  grade_id: number | null;
  class_id: number | null;
}

interface UsersTabProps {
  currentUserId?: number;
}

const inputClass =
  "w-full h-10 px-3 border border-border rounded-lg bg-muted text-foreground text-sm focus:outline-none focus:border-blue-500 focus:bg-card focus:ring-2 focus:ring-blue-500/10";

const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-blue-700 transition-colors border-none cursor-pointer";

const btnSecondary =
  "inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors border-none cursor-pointer";

const btnDanger =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-destructive/10 text-destructive hover:bg-red-200 transition-colors border-none cursor-pointer";

const selectClass =
  "w-full h-10 px-3 border border-border rounded-lg bg-muted text-foreground text-sm focus:outline-none focus:border-blue-500 focus:bg-card focus:ring-2 focus:ring-blue-500/10";

export default function UsersTab({ currentUserId }: UsersTabProps) {
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [classParam, setClassParam] = useState<ClassFilterParams | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState<RegForm>({ username: "", password: "", role: "student", display_name: "", student_id: "", class_id: "" });
  const [regGrade, setRegGrade] = useState("");
  const [regMsg, setRegMsg] = useState("");
  const [showEditUser, setShowEditUser] = useState(false);
  const [editUser, setEditUser] = useState<UserBrief | null>(null);
  const [editUserForm, setEditUserForm] = useState<EditUserForm>({ display_name: "", student_id: "", role: "", password: "", class_id: "" });
  const [editGrade, setEditGrade] = useState("");
  const [editUserMsg, setEditUserMsg] = useState("");
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batchPreview, setBatchPreview] = useState<BatchUser[]>([]);
  const [batchParseError, setBatchParseError] = useState("");
  const [batchResult, setBatchResult] = useState<BatchCreateResult | null>(null);
  const [batchImporting, setBatchImporting] = useState(false);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [regClasses, setRegClasses] = useState<ClassItem[]>([]);
  const [editClasses, setEditClasses] = useState<ClassItem[]>([]);
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const toast = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  const loadUsers = useCallback(
    (_offset?: number) => {
      const params: Record<string, unknown> = { offset: _offset != null ? _offset : offset, limit: LIMIT };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      if (classParam?.class_id) params.class_id = classParam.class_id;
      else if (classParam?.grade_id) params.grade_id = classParam.grade_id;
      getUsers(params)
        .then(({ data }) => {
          setUsers(data.items);
          setUserTotal(data.total);
        })
        .catch(() => toast.error("加载用户列表失败"));
    },
    [offset, search, roleFilter, classParam, toast],
  );

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    getGrades()
      .then((res) => setGrades(res.data))
      .catch(() => {});

    getClasses({})
      .then((res) => setAllClasses(res.data))
      .catch(() => {});

    getRoles()
      .then((res) => setRoles(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setOffset(0);
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegMsg("");
    try {
      const payload: Schemas["RegisterRequest"] = {
        username: regForm.username,
        password: regForm.password,
        role: regForm.role,
        display_name: regForm.display_name,
        student_id: regForm.student_id || null,
        class_id: regForm.class_id ? Number(regForm.class_id) : undefined,
      };
      await register(payload);
      setRegMsg("注册成功！");
      setRegForm({ username: "", password: "", role: "student", display_name: "", student_id: "", class_id: "" });
      setRegGrade("");
      setRegClasses([]);
      setOffset(0);
      loadUsers(0);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setRegMsg(e.response?.data?.detail || "注册失败");
    }
  };

  const openEditUser = (u: UserBrief) => {
    setEditUser(u);
    setEditUserForm({
      display_name: u.display_name,
      student_id: u.student_id || "",
      role: u.role,
      password: "",
      class_id: u.class_id != null ? String(u.class_id) : "",
    });
    setEditUserMsg("");
    if (u.class_id) {
      const found = allClasses.find((c) => c.id === u.class_id);
      if (found) {
        setEditGrade(String(found.grade_id));
        loadClassesForGrade(String(found.grade_id), setEditClasses);
      } else {
        setEditGrade("");
        setEditClasses([]);
      }
    } else {
      setEditGrade("");
      setEditClasses([]);
    }
    setShowEditUser(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditUserMsg("");
    const payload: Record<string, unknown> = {};
    if (editUserForm.display_name) payload.display_name = editUserForm.display_name;
    if (editUserForm.student_id) payload.student_id = editUserForm.student_id;
    else payload.student_id = null;
    if (editUserForm.role) payload.role = editUserForm.role;
    if (editUserForm.password) payload.password = editUserForm.password;
    if (editUserForm.class_id !== undefined && editUserForm.class_id !== "") payload.class_id = Number(editUserForm.class_id);
    else if (editUserForm.class_id === "") payload.class_id = 0;
    try {
      await updateUser(editUser!.id, payload);
      setShowEditUser(false);
      setOffset(0);
      loadUsers(0);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setEditUserMsg(e.response?.data?.detail || "保存失败");
    }
  };

  const handleDeleteUser = async (u: UserBrief) => {
    if (u.id === currentUserId) {
      toast.warning("不能删除自己的账号");
      return;
    }
    const ok = await confirm({
      title: "删除用户",
      message: `确定删除用户"${u.display_name}"(${u.username})吗？此操作不可恢复。`,
      confirmLabel: "确定删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteUser(u.id);
      toast.success("用户已删除");
      setOffset(0);
      loadUsers(0);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "删除失败");
    }
  };

  function parseBatchText(text: string) {
    setBatchParseError("");
    setBatchPreview([]);
    if (!text.trim()) {
      setBatchPreview([]);
      return;
    }
    const lines = text
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    const users: BatchUser[] = [];
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(",").map((s) => s.trim());
      if (parts.length < 4) {
        setBatchParseError(`第 ${i + 1} 行格式不正确，需要至少4列（用户名,密码,姓名,角色）`);
        setBatchPreview([]);
        return;
      }
      const classIdRaw = parts[5] ? parts[5].trim() : "";
      const classId = classIdRaw && /^\d+$/.test(classIdRaw) ? Number(classIdRaw) : null;
      if (classIdRaw && !/^\d+$/.test(classIdRaw)) {
        setBatchParseError(`第 ${i + 1} 行班级ID "${classIdRaw}" 无效，应为数字`);
        setBatchPreview([]);
        return;
      }
      users.push({
        username: parts[0],
        password: parts[1],
        display_name: parts[2],
        role: parts[3] || "student",
        student_id: parts[4] || null,
        class_id: classId,
      });
    }
    setBatchPreview(users);
  }

  function parseCSVFile(file: File) {
    setBatchParseError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || "").replace(/^\uFEFF/, "");
      const lines = text
        .trim()
        .split("\n")
        .filter((l) => l.trim());
      if (lines.length <= 1) {
        parseBatchText(text);
        return;
      }
      const firstIsHeader = !/^\d/.test(lines[0]);
      parseBatchText(firstIsHeader ? lines.slice(1).join("\n") : text);
    };
    reader.readAsText(file);
  }

  async function handleBatchImport() {
    if (batchPreview.length === 0) return;
    setBatchImporting(true);
    setBatchResult(null);
    try {
      const { data } = await batchCreateUsers(batchPreview);
      setBatchResult(data);
      if (data.created > 0) {
        toast.success(`成功创建 ${data.created} 名用户`);
        setOffset(0);
        loadUsers(0);
      }
      if (data.skipped > 0) toast.warning(`跳过 ${data.skipped} 名用户`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "批量导入失败");
    } finally {
      setBatchImporting(false);
    }
  }

  function handleDownloadTemplate() {
    const csvContent = "\uFEFF用户名,密码,姓名,角色,学号,班级ID\nstudent6,123456,赵六,student,2024006,\nstudent7,123456,钱七,student,2024007,";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "用户导入模板.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadClassesForGrade(gradeId: string, setter: (classes: ClassItem[]) => void) {
    if (!gradeId) {
      setter([]);
      return;
    }
    getClasses({ grade_id: String(gradeId) })
      .then((res) => setter(res.data))
      .catch(() => setter([]));
  }

  const filterSelectClass = "py-1.5 px-2.5 border border-border rounded-lg text-sm bg-card";

  return (
    <>
      <div className="mb-4 flex gap-3">
        <button className={btnPrimary} onClick={() => setShowRegister(!showRegister)}>
          {showRegister ? (
            "取消"
          ) : (
            <>
              <Plus size={16} /> 注册新用户
            </>
          )}
        </button>
        <button
          className={btnSecondary}
          onClick={() => {
            setShowBatchImport(true);
            setBatchText("");
            setBatchPreview([]);
            setBatchParseError("");
            setBatchResult(null);
          }}
        >
          <Users size={16} /> 批量导入
        </button>
      </div>

      {showRegister && (
        <div className="rounded-xl border border-border bg-card shadow-sm p-6 mb-5">
          <h3 className="mb-4 font-semibold text-lg">添加用户</h3>
          {regMsg && (
            <div
              className={cn(
                "px-3.5 py-2.5 rounded-lg text-sm mb-4 text-left",
                regMsg.includes("成功") ? "bg-green-50 text-green-600" : "bg-destructive/10 text-red-500",
              )}
            >
              {regMsg}
            </div>
          )}
          <form onSubmit={handleRegister} className="flex gap-3 flex-wrap items-end">
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
              <select
                value={regGrade}
                onChange={(e) => {
                  setRegGrade(e.target.value);
                  setRegForm({ ...regForm, class_id: "" });
                  loadClassesForGrade(e.target.value, setRegClasses);
                }}
                className={selectClass}
              >
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
              <select
                value={regForm.class_id}
                onChange={(e) => setRegForm({ ...regForm, class_id: e.target.value })}
                disabled={!regGrade}
                className={selectClass}
              >
                <option value="">不指定</option>
                {regClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={cn(btnPrimary, "h-10")}>
              注册
            </button>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-sm p-6">
        <div className="mb-3 flex gap-2 items-center">
          <div className="relative flex-1 max-w-[320px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
            <input
              ref={searchRef}
              type="text"
              placeholder="搜索用户名、姓名或学号..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full py-1.5 pl-[30px] pr-2.5 border border-border rounded-lg text-sm"
            />
          </div>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={filterSelectClass}>
            <option value="">全部角色</option>
            {roles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.display_name}
              </option>
            ))}
          </select>
          <ClassFilter onChange={setClassParam} />
          <span className="text-sm text-muted-foreground whitespace-nowrap">共 {userTotal} 人</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                  用户名
                </th>
                <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                  姓名
                </th>
                <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                  角色
                </th>
                <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                  班级
                </th>
                <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                  学号
                </th>
                <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                  注册时间
                </th>
                <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="cursor-pointer hover:bg-muted" onClick={() => navigate(`/admin/users/${u.id}`)}>
                  <td className="px-4 py-3 border-b border-border">{u.username}</td>
                  <td className="px-4 py-3 border-b border-border">{u.display_name}</td>
                  <td className="px-4 py-3 border-b border-border">
                    <span
                      className={cn(
                        "inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold",
                        u.role === "super_admin" || u.role === "school_admin"
                          ? "bg-red-50 text-red-700"
                          : u.role === "teacher"
                            ? "bg-blue-50 text-primary"
                            : "bg-green-50 text-green-700",
                      )}
                    >
                      {roles.find((r) => r.name === u.role)?.display_name || u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 border-b border-border text-muted-foreground text-sm">
                    {u.grade_name && u.class_name ? `${u.grade_name} ${u.class_name}` : u.class_name || "-"}
                  </td>
                  <td className="px-4 py-3 border-b border-border text-muted-foreground">{u.student_id || "-"}</td>
                  <td className="px-4 py-3 border-b border-border text-sm text-muted-foreground">{new Date(u.created_at).toLocaleString("zh-CN")}</td>
                  <td className="px-4 py-3 border-b border-border">
                    <div className="flex gap-2">
                      <button
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors border-none cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditUser(u);
                        }}
                        title="编辑"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        className={btnDanger}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteUser(u);
                        }}
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={userTotal} offset={offset} limit={LIMIT} onChange={setOffset} />
      </div>

      <Modal open={showEditUser} onClose={() => setShowEditUser(false)} title={`编辑用户: ${editUser?.display_name}`} maxWidth={480}>
        {editUserMsg && <div className="bg-destructive/10 text-red-500 px-3.5 py-2.5 rounded-lg text-sm mb-4 text-left">{editUserMsg}</div>}
        <form onSubmit={handleSaveUser}>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">姓名</label>
            <input
              className={inputClass}
              value={editUserForm.display_name}
              onChange={(e) => setEditUserForm((f) => ({ ...f, display_name: e.target.value }))}
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">学号</label>
            <input className={inputClass} value={editUserForm.student_id} onChange={(e) => setEditUserForm((f) => ({ ...f, student_id: e.target.value }))} />
          </div>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">角色</label>
            <select className={selectClass} value={editUserForm.role} onChange={(e) => setEditUserForm((f) => ({ ...f, role: e.target.value }))}>
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground font-semibold mb-1">年级</label>
            <select
              className={selectClass}
              value={editGrade}
              onChange={(e) => {
                setEditGrade(e.target.value);
                setEditUserForm((f) => ({ ...f, class_id: "" }));
                loadClassesForGrade(e.target.value, setEditClasses);
              }}
            >
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
              value={editUserForm.class_id}
              onChange={(e) => setEditUserForm((f) => ({ ...f, class_id: e.target.value }))}
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
              value={editUserForm.password}
              onChange={(e) => setEditUserForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="至少6位"
              minLength={6}
            />
          </div>
          <div className="flex gap-3 justify-end mt-4">
            <button type="button" className={btnSecondary} onClick={() => setShowEditUser(false)}>
              取消
            </button>
            <button type="submit" className={btnPrimary}>
              保存
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showBatchImport}
        onClose={() => {
          if (!batchImporting) setShowBatchImport(false);
        }}
        title={
          <>
            <Users size={20} /> 批量导入用户
          </>
        }
        maxWidth={650}
      >
        <div className="mb-3">
          <label className="font-semibold text-sm flex items-center gap-1.5 mb-2">
            <FileText size={14} /> 粘贴文本（每行一个用户，逗号分隔）
          </label>
          <textarea
            rows={5}
            placeholder="用户名,密码,姓名,角色,学号,班级ID\nstudent6,123456,赵六,student,2024006,1"
            value={batchText}
            onChange={(e) => {
              setBatchText(e.target.value);
              parseBatchText(e.target.value);
            }}
            className="w-full font-mono text-sm p-2 border border-border rounded-lg focus:outline-none focus:border-blue-500"
            disabled={batchImporting}
          />
          <div className="text-xs text-muted-foreground mt-1">格式：用户名,密码,姓名,角色,学号,班级ID（可选）</div>
        </div>
        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer">
            <Upload size={14} /> 上传 CSV 文件
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setBatchText("");
                  parseCSVFile(f);
                }
                e.target.value = "";
              }}
              className="hidden"
              disabled={batchImporting}
            />
          </label>
          <span className="text-primary cursor-pointer font-medium hover:underline text-sm" onClick={handleDownloadTemplate}>
            <Download size={14} className="inline align-middle mr-0.5 -mt-0.5" />
            下载模板
          </span>
        </div>
        {batchParseError && (
          <div className="text-red-500 text-sm mb-3 flex items-center gap-1.5">
            <AlertCircle size={16} /> {batchParseError}
          </div>
        )}
        {batchPreview.length > 0 && (
          <div className="mb-4">
            <div className="font-semibold text-sm mb-2">预览（{batchPreview.length} 名用户）</div>
            <div className="max-h-[200px] overflow-auto border border-border rounded-lg">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                      用户名
                    </th>
                    <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                      密码
                    </th>
                    <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                      姓名
                    </th>
                    <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                      角色
                    </th>
                    <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                      学号
                    </th>
                    <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                      班级ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {batchPreview.map((u, i) => (
                    <tr key={i} className="hover:bg-muted">
                      <td className="px-4 py-3 border-b border-border">{u.username}</td>
                      <td className="px-4 py-3 border-b border-border">{"*".repeat(Math.min(u.password.length, 8))}</td>
                      <td className="px-4 py-3 border-b border-border">{u.display_name}</td>
                      <td className="px-4 py-3 border-b border-border">
                        <span
                          className={cn(
                            "inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold",
                            u.role === "teacher" ? "bg-blue-50 text-primary" : "bg-green-50 text-green-700",
                          )}
                        >
                          {u.role === "teacher" ? "教师" : "学生"}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-b border-border text-muted-foreground">{u.student_id || "-"}</td>
                      <td className="px-4 py-3 border-b border-border text-muted-foreground">{u.class_id || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {batchResult && (
          <div
            className={cn(
              "mb-4 px-4 py-3 rounded-lg text-sm",
              batchResult.created > 0 ? "bg-green-50 border border-green-300" : "bg-amber-50 border border-amber-300",
            )}
          >
            <div>
              创建成功: <strong className="text-green-500">{batchResult.created}</strong> 名
            </div>
            <div>
              跳过: <strong className="text-amber-500">{batchResult.skipped}</strong> 名
            </div>
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <button className={btnSecondary} onClick={() => setShowBatchImport(false)} disabled={batchImporting}>
            取消
          </button>
          <button
            className={cn(btnPrimary, "disabled:opacity-50 disabled:cursor-not-allowed")}
            disabled={batchPreview.length === 0 || batchImporting}
            onClick={handleBatchImport}
          >
            {batchImporting ? "导入中..." : `导入 ${batchPreview.length} 名用户`}
          </button>
        </div>
      </Modal>
    </>
  );
}
