import { Building2, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/axios-instance";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Modal from "@/components/ui/Modal";

interface SchoolItem {
  id: number;
  name: string;
  teacher_count: number;
  student_count: number;
  created_at: string;
}

export default function SchoolsPage() {
  const [schools, setSchools] = useState<SchoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const { confirm } = useConfirm();

  const loadSchools = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/schools", { params: { limit: 100 } });
      setSchools(data.items || []);
    } catch {
      toast.error("加载学校列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchools();
  }, []);

  const handleCreate = async () => {
    if (!name.trim() || !adminUsername.trim() || !adminPassword || !adminDisplayName.trim()) {
      toast.error("请填写所有字段");
      return;
    }
    try {
      await api.post("/admin/schools", { name, admin_username: adminUsername, admin_password: adminPassword, admin_display_name: adminDisplayName });
      toast.success("学校创建成功");
      setName("");
      setAdminUsername("");
      setAdminPassword("");
      setAdminDisplayName("");
      setShowCreate(false);
      loadSchools();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "创建失败");
    }
  };

  const handleDelete = async (id: number, schoolName: string) => {
    const ok = await confirm({
      title: "删除学校",
      message: `确定要删除学校「${schoolName}」？此操作不可恢复。`,
    });
    if (!ok) return;
    try {
      await api.delete("/admin/schools/" + id);
      toast.success("学校已删除");
      loadSchools();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "删除失败");
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">学校管理</h1>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} /> 新建学校
          </Button>
        </div>

        <div className="rounded-xl border bg-card">
          {loading && schools.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : schools.length === 0 ? (
            <EmptyState icon={Building2} title="暂无学校" description="创建第一个学校后这里会显示" />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="px-4 py-3">学校名称</th>
                  <th className="px-4 py-3">教师数</th>
                  <th className="px-4 py-3">学生数</th>
                  <th className="px-4 py-3">创建时间</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 text-sm">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3">{s.teacher_count}</td>
                    <td className="px-4 py-3">{s.student_count}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}</td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" className="text-destructive h-8" onClick={() => handleDelete(s.id, s.name)}>
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建学校">
          <div className="space-y-4 py-2">
            <div>
              <Label>学校名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：北京护理学院" />
            </div>
            <div>
              <Label>管理员用户名</Label>
              <Input value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} placeholder="学校管理员账号" />
            </div>
            <div>
              <Label>管理员密码</Label>
              <Input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="至少6位" />
            </div>
            <div>
              <Label>管理员显示名</Label>
              <Input value={adminDisplayName} onChange={(e) => setAdminDisplayName(e.target.value)} placeholder="管理员姓名" />
            </div>
            <Button className="w-full" onClick={handleCreate}>
              创建学校
            </Button>
          </div>
        </Modal>
      </div>
    </Layout>
  );
}
