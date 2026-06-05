import { GraduationCap, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import FormField from "@/components/ui/FormField";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import useGradesClassesStore from "@/stores/gradesClassesStore";
import type { ClassItem, Grade } from "@/types/store";

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

const selectClass = "px-2.5 py-1.5 border border-border rounded-md text-sm bg-card";

export default function GradesClassesPage() {
  const [tab, setTab] = useState<"grades" | "classes">("grades");
  const [gradeFilter, setGradeFilter] = useState("");
  const [gradeSearch, setGradeSearch] = useState("");
  const [classSearch, setClassSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formGradeId, setFormGradeId] = useState("");
  const toast = useToast();
  const { confirm } = useConfirm();

  const { grades, classes, loading, fetchGrades, fetchClasses, createGrade, updateGrade, deleteGrade, createClass, updateClass, deleteClass } =
    useGradesClassesStore();

  useEffect(() => {
    fetchGrades();
  }, [fetchGrades]);
  useEffect(() => {
    fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
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

  const handleDeleteGrade = async (item: Grade) => {
    const ok = await confirm({
      title: "删除年级",
      message: `确定要删除年级「${item.name}」吗？将同时删除该年级下所有班级，学生班级归属将被清除。`,
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteGrade(item.id);
      fetchGrades();
      fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
      toast.success("已删除");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "操作失败");
    }
  };

  const handleDeleteClass = async (item: ClassItem) => {
    const ok = await confirm({
      title: "删除班级",
      message: `确定要删除班级「${item.name}」吗？该班级中学生将变为无归属状态。`,
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteClass(item.id);
      fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
      toast.success("已删除");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "操作失败");
    }
  };

  const tabs = [
    { key: "grades", label: "年级管理" },
    { key: "classes", label: "班级管理" },
  ];

  const columns = tab === "grades" ? GRADE_COLUMNS : CLASS_COLUMNS;

  const filteredGrades = grades.filter((g: Grade) => !gradeSearch || g.name.toLowerCase().includes(gradeSearch.toLowerCase()));
  const filteredClasses = classes.filter((c: ClassItem) => !classSearch || c.name.toLowerCase().includes(classSearch.toLowerCase()));
  const items = tab === "grades" ? filteredGrades : filteredClasses;

  return (
    <Layout>
      <div>
        <PageHeader
          title="班级管理"
          subtitle="管理年级和班级，组织学生归属"
          actions={<Button onClick={openCreate}>新建{tab === "grades" ? "年级" : "班级"}</Button>}
        />

        <div className="flex gap-0 mb-4 border-b-2 border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as "grades" | "classes")}
              className={cn(
                "px-6 py-2 border-none bg-transparent cursor-pointer border-b-2 mb-[-2px]",
                tab === t.key ? "font-semibold text-primary border-primary" : "font-normal text-muted-foreground border-transparent",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "classes" && (
          <div className="mb-4 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索班级..."
                value={classSearch}
                onChange={(e) => setClassSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-muted focus:outline-none focus:border-blue-500 focus:bg-card"
              />
            </div>
            <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className={selectClass}>
              <option value="">全部年级</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === "grades" && (
          <div className="mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索年级..."
                value={gradeSearch}
                onChange={(e) => setGradeSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-muted focus:outline-none focus:border-blue-500 focus:bg-card"
              />
            </div>
          </div>
        )}

        <div className="bg-card rounded-xl shadow-sm p-6 border border-border overflow-x-auto">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title={tab === "grades" ? "暂无年级" : "暂无班级"}
              description={tab === "grades" ? "创建第一个年级后这里会显示" : "创建第一个班级后这里会显示"}
            />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border"
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="group hover:bg-muted">
                    {columns.map((col) => (
                      <td key={col.key} className={cn("px-4 py-3 border-b border-border", col.key === "created_at" && "text-xs text-muted-foreground")}>
                        {col.render
                          ? col.render(String((item as unknown as Record<string, unknown>)[col.key]))
                          : String((item as unknown as Record<string, unknown>)[col.key] || "")}
                      </td>
                    ))}
                    <td className="px-4 py-3 border-b border-border">
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:bg-destructive/10"
                          onClick={() => (tab === "grades" ? handleDeleteGrade(item as Grade) : handleDeleteClass(item as ClassItem))}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Modal
          open={modalOpen}
          onClose={() => {
            setFormName("");
            setFormGradeId("");
            setEditId(null);
            setModalOpen(false);
          }}
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
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-card focus:outline-none focus:border-blue-500"
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
              className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:border-blue-500"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={tab === "grades" ? "如: 2024级" : "如: 护理1班"}
            />
          </FormField>
        </Modal>
      </div>
    </Layout>
  );
}
