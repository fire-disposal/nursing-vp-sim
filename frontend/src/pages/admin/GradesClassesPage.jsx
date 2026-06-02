import { useEffect, useState } from "react";
import { createClass, createGrade, deleteClass, deleteGrade, getClasses, getGrades, updateClass, updateGrade } from "../../api";
import { useToast } from "../../components/Toast";
import Button from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import FormField from "../../components/ui/FormField";
import Modal from "../../components/ui/Modal";
import PageHeader from "../../components/ui/PageHeader";
import Layout from "../../components/Layout";

const GRADE_COLUMNS = [
  { key: "name", label: "年级名称" },
  { key: "class_count", label: "班级数" },
  { key: "student_count", label: "学生数" },
  { key: "created_at", label: "创建时间", render: (v) => (v ? new Date(v).toLocaleDateString("zh-CN") : "") },
];

const CLASS_COLUMNS = [
  { key: "grade_name", label: "所属年级" },
  { key: "name", label: "班级名称" },
  { key: "student_count", label: "学生数" },
  { key: "created_at", label: "创建时间", render: (v) => (v ? new Date(v).toLocaleDateString("zh-CN") : "") },
];

export default function GradesClassesPage({ user, onLogout }) {
  const [tab, setTab] = useState("grades");
  const [grades, setGrades] = useState([]);
  const [classes, setClasses] = useState([]);
  const [gradeFilter, setGradeFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editId, setEditId] = useState(null);
  const [formName, setFormName] = useState("");
  const [formGradeId, setFormGradeId] = useState("");
  const toast = useToast();

  const loadGrades = () =>
    getGrades()
      .then(setGrades)
      .catch(() => toast.error("加载年级列表失败"));
  const loadClasses = () => {
    const params = gradeFilter ? { grade_id: Number(gradeFilter) } : {};
    getClasses(params)
      .then(setClasses)
      .catch(() => toast.error("加载班级列表失败"));
  };

  useEffect(() => {
    loadGrades();
  }, []);
  useEffect(() => {
    loadClasses();
  }, [gradeFilter]);

  const openCreate = () => {
    setEditId(null);
    setFormName("");
    setFormGradeId("");
    setModalOpen(true);
  };
  const openEdit = (item) => {
    setEditId(item.id);
    setFormName(item.name);
    if (tab === "classes") {
      setFormGradeId(String(item.grade_id));
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
          await updateGrade(editId, { name: formName.trim() });
        } else {
          await createGrade({ name: formName.trim() });
        }
        loadGrades();
      } else {
        if (!formGradeId) {
          toast.error("请选择所属年级");
          return;
        }
        const data = { name: formName.trim(), grade_id: Number(formGradeId) };
        if (editId) {
          await updateClass(editId, data);
        } else {
          await createClass(data);
        }
        loadClasses();
      }
      setModalOpen(false);
      toast.success(editId ? "已更新" : "已创建");
    } catch (e) {
      toast.error(e.response?.data?.detail || "操作失败");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (tab === "grades") {
        await deleteGrade(deleteTarget.id);
        loadGrades();
      } else {
        await deleteClass(deleteTarget.id);
        loadClasses();
      }
      toast.success("已删除");
    } catch (e) {
      toast.error(e.response?.data?.detail || "删除失败");
    }
    setDeleteTarget(null);
  };

  const tabs = [
    { key: "grades", label: "年级管理" },
    { key: "classes", label: "班级管理" },
  ];

  return (
    <Layout user={user} onLogout={onLogout}>
      <div>
        <PageHeader
          title="班级管理"
          subtitle="管理年级和班级，组织学生归属"
          actions={<Button onClick={openCreate}>新建{tab === "grades" ? "年级" : "班级"}</Button>}
        />

        <div style={{ display: "flex", gap: 0, marginBottom: "1rem", borderBottom: "2px solid var(--border)" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "0.5rem 1.25rem",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? "var(--primary)" : "var(--text-secondary)",
                borderBottom: tab === t.key ? "2px solid var(--primary)" : "2px solid transparent",
                marginBottom: -2,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "classes" && (
          <div style={{ marginBottom: "1rem" }}>
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              style={{
                padding: "7px 10px",
                border: "1px solid var(--gray-200)",
                borderRadius: "var(--radius-md)",
                fontSize: "0.82rem",
                fontFamily: "inherit",
                background: "#fff",
              }}
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

        {/* Simple table rendering */}
        <div className="card">
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                {(tab === "grades" ? GRADE_COLUMNS : CLASS_COLUMNS).map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(tab === "grades" ? grades : classes).map((item) => (
                <tr key={item.id}>
                  {(tab === "grades" ? GRADE_COLUMNS : CLASS_COLUMNS).map((col) => (
                    <td key={col.key} style={col.key === "created_at" ? { fontSize: "0.8rem", color: "var(--text-secondary)" } : {}}>
                      {col.render ? col.render(item[col.key]) : item[col.key]}
                    </td>
                  ))}
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
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
                className="form-input"
                style={{ width: "100%", padding: "8px 12px" }}
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
              className="form-input"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={{ width: "100%", padding: "8px 12px" }}
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
