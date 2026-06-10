import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Eye, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAssignment, deleteAssignment, getAssignment as fetchAssignment, getAssignments, updateAssignment } from "@/api/assignments";
import { getCases } from "@/api/cases";
import { getClasses } from "@/api/grades-classes";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FEATURE_FLAGS = [
  { key: "physical_exam", label: "护理查体" },
  { key: "emotion", label: "情绪状态机" },
  { key: "patient_initiative", label: "患者追问" },
  { key: "portrait", label: "患者立绘" },
  { key: "questionnaire", label: "问卷评估" },
];

const CONFIG_OPTIONS = [
  { value: "standard-assessment", label: "标准化考核" },
  { value: "scenario-simulation", label: "情景模拟" },
  { value: "free-exploration", label: "自由探索" },
  { value: "classroom-practice", label: "课堂练习" },
];

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const h = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${m}/${day} ${h}:${min}`;
}

function statusBadge(item: { start_time: string; end_time: string }) {
  const now = Date.now();
  if (now < new Date(item.start_time).getTime()) return <Badge variant="secondary">未开始</Badge>;
  if (now > new Date(item.end_time).getTime()) return <Badge variant="outline">已结束</Badge>;
  return <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">进行中</span>;
}

export default function AssignmentsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const emptyForm = useMemo(
    () => ({
      title: "",
      desc: "",
      caseId: 0,
      classId: 0,
      configId: "standard-assessment",
      features: {} as Record<string, boolean>,
      startTime: "",
      endTime: "",
    }),
    [],
  );
  const [form, setForm] = useState(emptyForm);
  const resetForm = () => setForm(emptyForm);
  const updateForm = (patch: Partial<typeof emptyForm>) => setForm((f) => ({ ...f, ...patch }));

  const { data: listData, isLoading } = useQuery({
    queryKey: ["assignments"],
    queryFn: () => getAssignments({ limit: 100 }),
  });
  const { data: casesData } = useQuery({
    queryKey: ["cases"],
    queryFn: () => getCases(),
  });
  const { data: classesData } = useQuery({
    queryKey: ["classes"],
    queryFn: () => getClasses({}),
  });

  const assignments = (listData?.data as any)?.items ?? [];
  const cases = (casesData?.data ?? []) as any[];
  const classes = (classesData?.data ?? []) as any[];

  const openCreate = () => {
    setEditingId(null);
    resetForm();
    setModalOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetchAssignment(id);
      const d = res.data as any;
      setEditingId(id);
      setForm({
        title: d.title,
        desc: d.description || "",
        caseId: d.case_id,
        classId: d.class_id,
        configId: d.config_id,
        features: d.feature_overrides || {},
        startTime: new Date(d.start_time).toISOString().slice(0, 16),
        endTime: new Date(d.end_time).toISOString().slice(0, 16),
      });
      setModalOpen(true);
    } catch (e: any) {
      toast.error(e.message || "加载失败");
    }
  };

  const handleSave = async () => {
    const { title, desc, caseId, classId, configId, features, startTime, endTime } = form;
    if (!title.trim() || !caseId || !classId || !startTime || !endTime) {
      toast.warning("请填写完整信息");
      return;
    }
    const payload = {
      title: title.trim(),
      description: desc.trim() || null,
      case_id: caseId,
      class_id: classId,
      config_id: configId,
      feature_overrides: features,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateAssignment(editingId, payload);
        toast.success("更新成功");
      } else {
        await createAssignment(payload);
        toast.success("创建成功");
      }
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      setModalOpen(false);
    } catch (e: any) {
      toast.error(e.message || "操作失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAssignment(deleteTarget);
      toast.success("已删除");
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
    } catch (e: any) {
      toast.error(e.message || "删除失败");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="练习发布"
        subtitle="按班级定时发布练习，控制插件特性，批量导出成绩"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} className="mr-1" />
            创建发布
          </Button>
        }
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : assignments.length === 0 ? (
        <EmptyState icon={Plus} title="暂无练习发布" description="点击上方按钮创建第一次练习发布" />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>病例</TableHead>
                <TableHead>班级</TableHead>
                <TableHead>时间窗口</TableHead>
                <TableHead>完成</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium max-w-[160px] truncate">{a.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.case_name}</TableCell>
                  <TableCell className="text-sm">{a.class_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(a.start_time)} ~ {formatDateTime(a.end_time)}
                  </TableCell>
                  <TableCell className="text-sm">{a.student_count > 0 ? `${a.completed_count}/${a.student_count}` : "-"}</TableCell>
                  <TableCell>{statusBadge(a)}</TableCell>
                  <TableCell>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/assignments/${a.id}`)} title="详情">
                        <Eye size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a.id)} title="编辑">
                        <Edit size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(a.id)} title="删除">
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "编辑练习发布" : "创建练习发布"} maxWidth={560}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium">标题</label>
            <Input value={form.title} onChange={(e) => updateForm({ title: e.target.value })} placeholder="练习标题" />
          </div>
          <div>
            <label className="text-sm font-medium">说明（可选）</label>
            <Input value={form.desc} onChange={(e) => updateForm({ desc: e.target.value })} placeholder="补充说明" />
          </div>
          <div>
            <label className="text-sm font-medium">病例</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.caseId || ""}
              onChange={(e) => updateForm({ caseId: Number(e.target.value) })}
            >
              <option value="">选择病例...</option>
              {cases.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">班级</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.classId || ""}
              onChange={(e) => updateForm({ classId: Number(e.target.value) })}
            >
              <option value="">选择班级...</option>
              {classes.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">训练模式</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.configId}
              onChange={(e) => updateForm({ configId: e.target.value })}
            >
              {CONFIG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">插件覆盖</label>
            <div className="grid grid-cols-2 gap-1.5">
              {FEATURE_FLAGS.map((f) => (
                <label key={f.key} className="flex items-center gap-1.5 text-sm py-0.5">
                  <input
                    type="checkbox"
                    checked={form.features[f.key] ?? false}
                    onChange={(e) => updateForm({ features: { ...form.features, [f.key]: e.target.checked } })}
                    className="size-4"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">开始时间</label>
              <Input type="datetime-local" value={form.startTime} onChange={(e) => updateForm({ startTime: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">截止时间</label>
              <Input type="datetime-local" value={form.endTime} onChange={(e) => updateForm({ endTime: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {editingId ? "保存" : "发布"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="确认删除" maxWidth={400}>
        <p className="text-sm text-muted-foreground mb-4">确定要删除这个练习发布吗？此操作不可逆。</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            取消
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            删除
          </Button>
        </div>
      </Modal>
    </div>
  );
}
