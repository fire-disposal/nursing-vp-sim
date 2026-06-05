import { Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/axios-instance";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Layout from "@/components/Layout";
import Modal from "@/components/ui/Modal";

interface RoleItem {
  id: number;
  name: string;
  display_name: string;
  is_system: boolean;
  permissions: string[];
  user_count: number;
}

const ALL_PERMISSIONS = [
  { key: "user_manage", label: "用户管理" },
  { key: "role_manage", label: "角色管理" },
  { key: "grade_class_manage", label: "班级管理" },
  { key: "case_manage", label: "病例管理" },
  { key: "training_access", label: "训练功能" },
  { key: "score_review", label: "成绩查看" },
  { key: "stats_view", label: "数据统计" },
  { key: "qa_access", label: "护理问答" },
  { key: "llm_monitor", label: "LLM 监控" },
  { key: "api_manage", label: "API 管理" },
  { key: "prompt_manage", label: "Prompt 管理" },
  { key: "feedback_review", label: "反馈管理" },
  { key: "export_data", label: "数据导出" },
  { key: "record_notes", label: "训练批注" },
  { key: "school_manage", label: "学校管理" },
];

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");

  const loadRoles = async () => {
    try {
      const { data } = await api.get("/admin/roles");
      setRoles(data || []);
    } catch {
      toast.error("加载角色列表失败");
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const togglePerm = (perm: string) => {
    setEditPerms((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]));
  };

  const startEdit = (role: RoleItem) => {
    setEditId(role.id);
    setEditPerms([...role.permissions]);
  };

  const saveEdit = async (roleId: number) => {
    try {
      await api.put("/admin/roles/" + roleId, { permissions: editPerms });
      toast.success("权限已保存");
      setEditId(null);
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "保存失败");
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newDisplayName.trim()) {
      toast.error("请填写角色名和显示名");
      return;
    }
    try {
      await api.post("/admin/roles", { name: newName, display_name: newDisplayName, permissions: [] });
      toast.success("角色已创建，请编辑权限");
      setNewName("");
      setNewDisplayName("");
      setShowCreate(false);
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "创建失败");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm("确定要删除角色「" + name + "」？")) return;
    try {
      await api.delete("/admin/roles/" + id);
      toast.success("角色已删除");
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "删除失败");
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">角色管理</h1>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} /> 新建角色
          </Button>
        </div>

        <div className="space-y-3">
          {roles.map((role) => (
            <div key={role.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-semibold">{role.display_name}</span>
                  <code className="ml-2 text-xs text-muted-foreground">{role.name}</code>
                  {role.is_system && <span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">系统</span>}
                  <span className="ml-2 text-xs text-muted-foreground">{role.user_count} 用户</span>
                </div>
                <div className="flex gap-2">
                  {editId === role.id ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => saveEdit(role.id)}>
                        <Save size={14} /> 保存
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                        <X size={14} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => startEdit(role)}>
                        编辑权限
                      </Button>
                      {!role.is_system && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(role.id, role.name)}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {editId === role.id ? (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {ALL_PERMISSIONS.map((p) => (
                    <label key={p.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="checkbox" checked={editPerms.includes(p.key)} onChange={() => togglePerm(p.key)} className="size-4" />
                      {p.label}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {role.permissions.length === 0 && <span className="text-xs text-muted-foreground">无权限</span>}
                  {role.permissions.map((p) => (
                    <span key={p} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {ALL_PERMISSIONS.find((ap) => ap.key === p)?.label || p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建角色">
          <div className="space-y-4 py-2">
            <div>
              <Label>角色标识</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="英文标识，如：intern_teacher" />
            </div>
            <div>
              <Label>显示名称</Label>
              <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="如：见习教师" />
            </div>
            <Button className="w-full" onClick={handleCreate}>
              创建角色
            </Button>
          </div>
        </Modal>
      </div>
    </Layout>
  );
}
