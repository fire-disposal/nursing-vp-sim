import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import FormField from "@/components/ui/FormField";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import useGradesClassesStore from "@/stores/gradesClassesStore";
import type { ClassItem, Grade } from "@/types/store";
import { cn } from "@/lib/utils";

const GRADE_COLUMNS = [
  { key: "name", label: "年级名称" },
  { key: "class_count", label: "班级数" },
  { key: "student_count", label: "学生数" },
  { key: "created_at", label: "创建时间", render: (v: string) => (v ? new Date(v).toLocaleDateString("zh-CN") : "") },
];

const CLASS_COLUMNS = [
  { key: "grade_name", label: "所属年级" },
  { key: "name", label: "班级名称" },
  { key: "student_count", label: "学生数" },
  { key: "created_at", label: "创建时间", render: (v: string) => (v ? new Date(v).toLocaleDateString("zh-CN") : "") },
];

export default function GradesClassesPage() {
  const [tab, setTab] = useState<"grades" | "classes">("grades");
  const [gradeFilter, setGradeFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Grade | ClassItem | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formGradeId, setFormGradeId] = useState("");
  const toast = useToast();

  const { grades, classes, fetchGrades, fetchClasses, createGrade, updateGrade, deleteGrade, createClass, updateClass, deleteClass } = useGradesClassesStore();

  useEffect(() => {
    fetchGrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchGrades]);
  useEffect(() => {
    fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeFilter, fetchClasses]);

  const openCreate = () => {
    setEditId(null);
    setFormName("");
    setFormGradeId("");
    setModalOpen(true);
  };
  const openEdit = (item: Grade | ClassItem) => {
    setEditId(item.id);
    setFormName(item.name);
    if (tab === "classes") {
      setFormGradeId(String((item as ClassItem).grade_id));
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error("名称不能为空");
      return;
    }
    try {
      if (tab === "grades") {
        if (editId) {
          await updateGrade(editId, formName.trim());
        } else {
          await createGrade(formName.trim());
        }
        fetchGrades();
      } else {
        if (!formGradeId) {
          toast.error("请选择所属年级");
          return;
        }
        if (editId) {
          await updateClass(editId, { name: formName.trim(), grade_id: Number(formGradeId) });
        } else {
          await createClass(Number(formGradeId), formName.trim());
        }
        fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
      }
      setModalOpen(false);
      toast.success(editId ? "已更新" : "已创建");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "操作失败");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (tab === "grades") {
        await deleteGrade(deleteTarget.id);
        fetchGrades();
        fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
      } else {
        await deleteClass(deleteTarget.id);
        fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
      }
      toast.success("已删除");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "操作失败");
    }
    setDeleteTarget(null);
  };

  const tabs = [
    { key: "grades", label: "年级管理" },
    { key: "classes", label: "班级管理" },
  ];

  return (
    <Layout>
      <div>
        <PageHeader
          title="班级管理"
          subtitle="管理年级和班级，组织学生归属"
          actions={<Button onClick={openCreate}>新建{tab === "grades" ? "年级" : "班级"}</Button>}
        />

        <div className="flex gap-0 mb-4 border-b-2 border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as "grades" | "classes")}
              className={cn(
                "px-6 py-2 border-none bg-transparent cursor-pointer border-b-2 mb-[-2px]",
                tab === t.key ? "font-semibold text-primary border-primary" : "font-normal text-gray-500 border-transparent",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "classes" && (
          <div className="mb-4">
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="px-2.5 py-[7px] border border-gray-200 rounded-[var(--radius-md)] text-sm bg-white"
            >
              <option value="">全部年级</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="bg-white rounded-[var(--radius-xl)] p-6 border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {(tab === "grades" ? GRADE_COLUMNS : CLASS_COLUMNS).map((col) => (
                  <th
                    key={col.key}
                    className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200"
                  >
                    {col.label}
                  </th>
                ))}
                <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">操作</th>
              </tr>
            </thead>
            <tbody>
              {(tab === "grades" ? grades : classes).map((item) => (
                <tr key={item.id} className="group">
                  {(tab === "grades" ? GRADE_COLUMNS : CLASS_COLUMNS).map((col) => (
                    <td
                      key={col.key}
                      className={cn("px-4 py-3 border-b border-gray-200 group-hover:bg-gray-50", col.key === "created_at" && "text-xs text-gray-500")}
                    >
                      {col.render
                        ? col.render(String((item as unknown as Record<string, unknown>)[col.key]))
                        : String((item as unknown as Record<string, unknown>)[col.key] || "")}
                    </td>
                  ))}
                  <td className="px-4 py-3 border-b border-gray-200 group-hover:bg-gray-50">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                        编辑
                      </Button>
                      <Button variant="ghost" size="sm" className="danger" onClick={() => setDeleteTarget(item)}>
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editId ? `编辑${tab === "grades" ? "年级" : "班级"}` : `新建${tab === "grades" ? "年级" : "班级"}`}
          footer={
            <>
              <Button variant="outline" onClick={() => setModalOpen(false)}>
                取消
              </Button>
              <Button onClick={handleSave}>{editId ? "保存" : "创建"}</Button>
            </>
          }
        >
          {tab === "classes" && (
            <FormField label="所属年级">
              <select
                value={formGradeId}
                onChange={(e) => setFormGradeId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-[var(--radius-md)] text-sm bg-white"
              >
                <option value="">请选择年级</option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label="名称">
            <input
              className="w-full px-3 py-2 border border-gray-200 rounded-[var(--radius-md)] text-sm"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={tab === "grades" ? "如: 2024级" : "如: 护理1班"}
            />
          </FormField>
        </Modal>

        <ConfirmDialog
          open={!!deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          title={`删除${tab === "grades" ? "年级" : "班级"}`}
          message={
            tab === "grades"
              ? `确定要删除年级「${deleteTarget?.name}」吗？将同时删除该年级下所有班级，学生班级归属将被清除。`
              : `确定要删除班级「${deleteTarget?.name}」吗？该班级中学生将变为无归属状态。`
          }
          danger
        />
      </div>
    </Layout>
  );
}
