import { AlertCircle, Download, Edit3, FileText, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { batchCreateUsers, deleteUser, getClasses, getGrades, getUsers, register, updateUser } from "@/api/api-client";
import Pagination from "@/components/ui/Pagination";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import ClassFilter from "./ClassFilter";
import type { components } from "@/api/api-types.gen";
import type { Grade, ClassItem } from "@/types/store";

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

interface ClassFilterParams {
  grade_id: number | null;
  class_id: number | null;
}

interface UsersTabProps {
  currentUserId?: number;
}

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
      .then(setGrades)
      .catch(() => {});
    getClasses({})
      .then(setAllClasses)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setOffset(0);
  }, [search, roleFilter, classParam]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegMsg("");
    try {
      const payload: Record<string, unknown> = { ...regForm };
      if (!payload.student_id) payload.student_id = null;
      if (regForm.class_id) payload.class_id = Number(regForm.class_id);
      else delete payload.class_id;
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
      const { data } = await batchCreateUsers(batchPreview as unknown as Record<string, unknown>[]);
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
      .then(setter)
      .catch(() => setter([]));
  }

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowRegister(!showRegister)}>
          {showRegister ? (
            "取消"
          ) : (
            <>
              <Plus size={16} /> 注册新用户
            </>
          )}
        </button>
        <button
          className="btn"
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
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 16 }}>添加用户</h3>
          {regMsg && <div className={regMsg.includes("成功") ? "success-msg" : "error-msg"}>{regMsg}</div>}
          <form onSubmit={handleRegister} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="form-group" style={{ flex: "1 1 120px", marginBottom: 0 }}>
              <label>用户名</label>
              <input value={regForm.username} onChange={(e) => setRegForm({ ...regForm, username: e.target.value })} required />
            </div>
            <div className="form-group" style={{ flex: "1 1 120px", marginBottom: 0 }}>
              <label>密码</label>
              <input
                type="password"
                value={regForm.password}
                onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                required
                minLength={6}
                placeholder="至少6位"
              />
            </div>
            <div className="form-group" style={{ flex: "1 1 100px", marginBottom: 0 }}>
              <label>角色</label>
              <select value={regForm.role} onChange={(e) => setRegForm({ ...regForm, role: e.target.value })}>
                <option value="student">学生</option>
                <option value="teacher">教师</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: "1 1 120px", marginBottom: 0 }}>
              <label>姓名</label>
              <input value={regForm.display_name} onChange={(e) => setRegForm({ ...regForm, display_name: e.target.value })} required />
            </div>
            <div className="form-group" style={{ flex: "1 1 100px", marginBottom: 0 }}>
              <label>学号</label>
              <input value={regForm.student_id} onChange={(e) => setRegForm({ ...regForm, student_id: e.target.value })} />
            </div>
            <div className="form-group" style={{ flex: "1 1 120px", marginBottom: 0 }}>
              <label>年级</label>
              <select
                value={regGrade}
                onChange={(e) => {
                  setRegGrade(e.target.value);
                  setRegForm({ ...regForm, class_id: "" });
                  loadClassesForGrade(e.target.value, setRegClasses);
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
            <div className="form-group" style={{ flex: "1 1 120px", marginBottom: 0 }}>
              <label>班级</label>
              <select value={regForm.class_id} onChange={(e) => setRegForm({ ...regForm, class_id: e.target.value })} disabled={!regGrade}>
                <option value="">不指定</option>
                {regClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" style={{ height: 42 }}>
              注册
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--gray-400)" }} />
            <input
              ref={searchRef}
              type="text"
              placeholder="搜索用户名、姓名或学号..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "7px 10px 7px 30px",
                border: "1px solid var(--gray-200)",
                borderRadius: "var(--radius-md)",
                fontSize: "0.82rem",
                fontFamily: "inherit",
              }}
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{
              padding: "7px 10px",
              border: "1px solid var(--gray-200)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.82rem",
              fontFamily: "inherit",
              background: "#fff",
            }}
          >
            <option value="">全部角色</option>
            <option value="student">学生</option>
            <option value="teacher">教师</option>
          </select>
          <ClassFilter onChange={setClassParam} />
          <span style={{ fontSize: "0.78rem", color: "var(--gray-500)", whiteSpace: "nowrap" }}>共 {userTotal} 人</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>姓名</th>
              <th>角色</th>
              <th>班级</th>
              <th>学号</th>
              <th>注册时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/admin/users/${u.id}`)}>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>
                  <span className={`badge ${u.role === "teacher" ? "badge-info" : "badge-success"}`}>{u.role === "teacher" ? "教师" : "学生"}</span>
                </td>
                <td style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
                  {u.grade_name && u.class_name ? `${u.grade_name} ${u.class_name}` : u.class_name || "-"}
                </td>
                <td style={{ color: "var(--text-secondary)" }}>{u.student_id || "-"}</td>
                <td style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{new Date(u.created_at).toLocaleString("zh-CN")}</td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditUser(u);
                      }}
                      title="编辑"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
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
        <Pagination total={userTotal} offset={offset} limit={LIMIT} onChange={setOffset} />
      </div>

      {/* Edit User Modal */}
      <Modal open={showEditUser} onClose={() => setShowEditUser(false)} title={`编辑用户: ${editUser?.display_name}`} maxWidth={480}>
        {editUserMsg && (
          <div className="error-msg" style={{ marginBottom: 16 }}>
            {editUserMsg}
          </div>
        )}
        <form onSubmit={handleSaveUser}>
          <div className="form-group">
            <label>姓名</label>
            <input value={editUserForm.display_name} onChange={(e) => setEditUserForm((f) => ({ ...f, display_name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>学号</label>
            <input value={editUserForm.student_id} onChange={(e) => setEditUserForm((f) => ({ ...f, student_id: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>角色</label>
            <select value={editUserForm.role} onChange={(e) => setEditUserForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="student">学生</option>
              <option value="teacher">教师</option>
            </select>
          </div>
          <div className="form-group">
            <label>年级</label>
            <select
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
          <div className="form-group">
            <label>班级</label>
            <select value={editUserForm.class_id} onChange={(e) => setEditUserForm((f) => ({ ...f, class_id: e.target.value }))} disabled={!editGrade}>
              <option value="">不指定</option>
              {editClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>新密码（留空不修改）</label>
            <input
              type="password"
              value={editUserForm.password}
              onChange={(e) => setEditUserForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="至少6位"
              minLength={6}
            />
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setShowEditUser(false)}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              保存
            </button>
          </div>
        </form>
      </Modal>

      {/* Batch Import Modal */}
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
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
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
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }}
            disabled={batchImporting}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 4 }}>格式：用户名,密码,姓名,角色,学号,班级ID（可选）</div>
        </div>
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
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
              style={{ display: "none" }}
              disabled={batchImporting}
            />
          </label>
          <span className="link" onClick={handleDownloadTemplate} style={{ fontSize: "0.8rem" }}>
            <Download size={14} style={{ verticalAlign: -3, marginRight: 2 }} />
            下载模板
          </span>
        </div>
        {batchParseError && (
          <div style={{ color: "var(--red-500)", fontSize: "0.82rem", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertCircle size={16} /> {batchParseError}
          </div>
        )}
        {batchPreview.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 8 }}>预览（{batchPreview.length} 名用户）</div>
            <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--border-color)", borderRadius: 8 }}>
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>密码</th>
                    <th>姓名</th>
                    <th>角色</th>
                    <th>学号</th>
                    <th>班级ID</th>
                  </tr>
                </thead>
                <tbody>
                  {batchPreview.map((u, i) => (
                    <tr key={i}>
                      <td>{u.username}</td>
                      <td>{"*".repeat(Math.min(u.password.length, 8))}</td>
                      <td>{u.display_name}</td>
                      <td>
                        <span className={`badge ${u.role === "teacher" ? "badge-info" : "badge-success"}`}>{u.role === "teacher" ? "教师" : "学生"}</span>
                      </td>
                      <td style={{ color: "var(--text-secondary)" }}>{u.student_id || "-"}</td>
                      <td style={{ color: "var(--text-secondary)" }}>{u.class_id || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {batchResult && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: "0.85rem",
              background: batchResult.created > 0 ? "#f0fdf4" : "#fffbeb",
              border: `1px solid ${batchResult.created > 0 ? "#86efac" : "#fde68a"}`,
            }}
          >
            <div>
              创建成功: <strong style={{ color: "var(--green-500)" }}>{batchResult.created}</strong> 名
            </div>
            <div>
              跳过: <strong style={{ color: "var(--amber-500)" }}>{batchResult.skipped}</strong> 名
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setShowBatchImport(false)} disabled={batchImporting}>
            取消
          </button>
          <button className="btn btn-primary" disabled={batchPreview.length === 0 || batchImporting} onClick={handleBatchImport}>
            {batchImporting ? "导入中..." : `导入 ${batchPreview.length} 名用户`}
          </button>
        </div>
      </Modal>
    </>
  );
}
