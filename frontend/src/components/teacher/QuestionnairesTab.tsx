import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, ClipboardCheck, Download, Edit3, FileText, GripVertical, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/axios-instance";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";

interface TemplateListItem {
  id: number;
  title: string;
  type: string;
  description?: string;
  is_active: boolean;
  question_count: number;
  response_count: number;
  school_id?: number;
  created_at: string;
  updated_at: string;
}

interface QuestionItem {
  id: number;
  content: string;
  question_type: string;
  required: boolean;
  sort_order: number;
  options?: string[];
}

interface TemplateDetail extends TemplateListItem {
  questions: QuestionItem[];
  case_ids: number[];
}

interface QuestionForm {
  id?: number;
  content: string;
  question_type: string;
  required: boolean;
  sort_order: number;
  options: string[];
}

interface TemplateForm {
  title: string;
  type: string;
  description: string;
  is_active: boolean;
  questions: QuestionForm[];
}

interface CaseBrief {
  id: number;
  name: string;
  chief_complaint?: string;
}

interface AssignForm {
  case_ids: number[];
  is_required: boolean;
  trigger_event: string;
}

interface ResponseStats {
  total_assigned: number;
  completed_count: number;
  completion_rate: number;
  questions: QuestionStats[];
}

interface QuestionStats {
  question_id: number;
  content: string;
  question_type: string;
  stats: {
    average?: number;
    distribution?: Record<string, number>;
    responses?: string[];
  };
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  likert_5: "李克特5级量表",
  multiple_choice: "多选题",
  short_text: "简答题",
};

const QUESTION_TYPE_OPTIONS = [
  { value: "likert_5", label: "李克特5级量表" },
  { value: "multiple_choice", label: "多选题" },
  { value: "short_text", label: "简答题" },
];

const TYPE_LABEL: Record<string, string> = {
  pre: "前测",
  post: "后测",
};

const TYPE_OPTIONS = [
  { value: "", label: "全部" },
  { value: "pre", label: "前测" },
  { value: "post", label: "后测" },
];

const TRIGGER_EVENT_OPTIONS = [
  { value: "after_training", label: "训练完成后" },
  { value: "before_training", label: "训练开始前" },
];

const inputClass =
  "w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10";

const textareaClass =
  "w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 resize-y";

function emptyForm(): TemplateForm {
  return {
    title: "",
    type: "pre",
    description: "",
    is_active: true,
    questions: [],
  };
}

function emptyQuestion(sortOrder: number): QuestionForm {
  return {
    content: "",
    question_type: "likert_5",
    required: true,
    sort_order: sortOrder,
    options: [],
  };
}

export default function QuestionnairesTab() {
  const [view, setView] = useState<"list" | "stats">("list");
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm());
  const [editMsg, setEditMsg] = useState("");
  const [statsTemplate, setStatsTemplate] = useState<TemplateListItem | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [showAssign, setShowAssign] = useState(false);
  const [assignTemplate, setAssignTemplate] = useState<TemplateListItem | null>(null);
  const [assignForm, setAssignForm] = useState<AssignForm>({
    case_ids: [],
    is_required: true,
    trigger_event: "after_training",
  });
  const LIMIT = 20;

  const queryClient = useQueryClient();
  const { confirm } = useConfirm();

  const params: Record<string, unknown> = { offset, limit: LIMIT };
  if (typeFilter) params.type = typeFilter;

  const { data: templatesData, isLoading } = useQuery({
    queryKey: ["questionnaireTemplates", offset, typeFilter],
    queryFn: () => api.get("/questionnaires/templates", { params }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const templates: TemplateListItem[] = templatesData?.items ?? [];
  const total = templatesData?.total ?? 0;

  const { data: casesData } = useQuery({
    queryKey: ["cases", "all"],
    queryFn: () => api.get("/cases", { params: { limit: 1000 } }).then((r) => r.data),
    enabled: showAssign,
  });

  const allCases: CaseBrief[] = casesData?.items ?? [];

  const { data: templateDetail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ["questionnaireTemplateDetail", editingId],
    queryFn: () => api.get(`/questionnaires/templates/${editingId}`).then((r) => r.data as TemplateDetail),
    enabled: editingId !== null && showEditor,
  });

  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    queryKey: ["questionnaireStats", statsTemplate?.id],
    queryFn: () => api.get(`/questionnaires/responses/${statsTemplate?.id}/stats`).then((r) => r.data),
    enabled: view === "stats" && statsTemplate !== null,
  });

  const stats: ResponseStats | null = statsData ?? null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        type: form.type,
        description: form.description,
        is_active: form.is_active,
        questions: form.questions.map((q) => ({
          ...(q.id ? { id: q.id } : {}),
          content: q.content,
          question_type: q.question_type,
          required: q.required,
          sort_order: q.sort_order,
          options: q.question_type === "multiple_choice" ? q.options.filter(Boolean) : undefined,
        })),
      };
      if (editingId) {
        return api.put(`/questionnaires/templates/${editingId}`, payload);
      }
      return api.post("/questionnaires/templates", payload);
    },
    onSuccess: () => {
      setShowEditor(false);
      setEditingId(null);
      setForm(emptyForm());
      queryClient.invalidateQueries({ queryKey: ["questionnaireTemplates"] });
      toast.success(editingId ? "问卷模板已更新" : "问卷模板已创建");
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { detail?: string } } };
      setEditMsg(e.response?.data?.detail || "保存失败");
      toast.error(e.response?.data?.detail || "保存失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/questionnaires/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["questionnaireTemplates"] });
      toast.success("问卷模板已删除");
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "删除失败");
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => api.put(`/questionnaires/templates/${assignTemplate?.id}/case-assignments`, assignForm),
    onSuccess: () => {
      setShowAssign(false);
      setAssignTemplate(null);
      queryClient.invalidateQueries({ queryKey: ["questionnaireTemplates"] });
      toast.success("病例分配已更新");
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "分配失败");
    },
  });

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm());
    setEditMsg("");
    setShowEditor(true);
  };

  const openEdit = (t: TemplateListItem) => {
    setEditingId(t.id);
    setEditMsg("");
    setShowEditor(true);
  };

  const loadTemplateDetailForForm = () => {
    if (templateDetail) {
      setForm({
        title: templateDetail.title,
        type: templateDetail.type,
        description: templateDetail.description || "",
        is_active: templateDetail.is_active,
        questions: templateDetail.questions.map((q) => ({
          id: q.id,
          content: q.content,
          question_type: q.question_type,
          required: q.required,
          sort_order: q.sort_order,
          options: q.options || [],
        })),
      });
    }
  };

  if (editingId && templateDetail && showEditor) {
    loadTemplateDetailForForm();
  }

  const validateForm = (): boolean => {
    if (!form.title.trim()) {
      setEditMsg("请输入问卷标题");
      return false;
    }
    if (form.title.trim().length > 200) {
      setEditMsg("问卷标题不能超过200个字符");
      return false;
    }
    for (let i = 0; i < form.questions.length; i++) {
      if (!form.questions[i].content.trim()) {
        setEditMsg(`第 ${i + 1} 题的内容不能为空`);
        return false;
      }
    }
    return true;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditMsg("");
    if (!validateForm()) return;
    saveMutation.mutate();
  };

  const handleDelete = async (t: TemplateListItem) => {
    const ok = await confirm({
      title: "删除问卷模板",
      message: `确定删除问卷"${t.title}"吗？此操作不可恢复。`,
      confirmLabel: "确定删除",
      danger: true,
    });
    if (!ok) return;
    deleteMutation.mutate(t.id);
  };

  const openAssign = async (t: TemplateListItem) => {
    setAssignTemplate(t);
    try {
      const detail: TemplateDetail = await api.get(`/questionnaires/templates/${t.id}`).then((r) => r.data);
      setAssignForm({
        case_ids: detail.case_ids || [],
        is_required: true,
        trigger_event: "after_training",
      });
    } catch {
      setAssignForm({
        case_ids: [],
        is_required: true,
        trigger_event: "after_training",
      });
    }
    setShowAssign(true);
  };

  const handleAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    assignMutation.mutate();
  };

  const openStats = (t: TemplateListItem) => {
    setStatsTemplate(t);
    setView("stats");
  };

  const backToList = () => {
    setView("list");
    setStatsTemplate(null);
  };

  const exportCSV = async (templateId: number) => {
    try {
      const response = await api.get(`/questionnaires/responses/${templateId}/export`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `questionnaire_responses_${templateId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV 导出成功");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "导出失败");
    }
  };

  const addQuestion = () => {
    setForm((prev) => ({
      ...prev,
      questions: [...prev.questions, emptyQuestion(prev.questions.length + 1)],
    }));
  };

  const removeQuestion = (index: number) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== index).map((q, i) => ({ ...q, sort_order: i + 1 })),
    }));
  };

  const updateQuestion = (index: number, updates: Partial<QuestionForm>) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => (i === index ? { ...q, ...updates } : q)),
    }));
  };

  const moveQuestion = (index: number, direction: "up" | "down") => {
    setForm((prev) => {
      const questions = [...prev.questions];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= questions.length) return prev;
      const tmp = questions[index];
      questions[index] = questions[targetIndex];
      questions[targetIndex] = tmp;
      return {
        ...prev,
        questions: questions.map((q, i) => ({ ...q, sort_order: i + 1 })),
      };
    });
  };

  const toggleCaseId = (caseId: number) => {
    setAssignForm((prev) => ({
      ...prev,
      case_ids: prev.case_ids.includes(caseId) ? prev.case_ids.filter((id) => id !== caseId) : [...prev.case_ids, caseId],
    }));
  };

  const selectAllCases = () => {
    setAssignForm((prev) => ({
      ...prev,
      case_ids: allCases.map((c) => c.id),
    }));
  };

  const deselectAllCases = () => {
    setAssignForm((prev) => ({
      ...prev,
      case_ids: [],
    }));
  };

  if (view === "stats" && statsTemplate) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              type="button"
              onClick={backToList}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2 cursor-pointer"
            >
              <ArrowLeft size={14} />
              返回列表
            </button>
            <h2 className="text-lg font-semibold">{statsTemplate.title} - 数据统计</h2>
          </div>
          <Button variant="outline" onClick={() => exportCSV(statsTemplate.id)}>
            <Download size={14} /> 导出CSV
          </Button>
        </div>

        {isLoadingStats ? (
          <LoadingState message="加载统计数据..." />
        ) : stats ? (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-border bg-muted p-4 text-center">
                <div className="text-2xl font-bold text-primary">{stats.total_assigned}</div>
                <div className="text-xs text-muted-foreground mt-1">总分配数</div>
              </div>
              <div className="rounded-xl border border-border bg-muted p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{stats.completed_count}</div>
                <div className="text-xs text-muted-foreground mt-1">已完成</div>
              </div>
              <div className="rounded-xl border border-border bg-muted p-4 text-center">
                <div className="text-2xl font-bold text-amber-600">{(stats.completion_rate * 100).toFixed(1)}%</div>
                <div className="text-xs text-muted-foreground mt-1">完成率</div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <BarChart3 size={14} />
                各题分析
              </h3>
              {stats.questions.length === 0 ? (
                <EmptyState title="暂无题目数据" />
              ) : (
                <div className="space-y-4">
                  {stats.questions.map((q) => (
                    <div key={q.question_id} className="border border-border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="info">{QUESTION_TYPE_LABELS[q.question_type] || q.question_type}</Badge>
                        <span className="text-sm font-medium">{q.content}</span>
                      </div>
                      {q.question_type === "likert_5" && q.stats.average != null && (
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">平均分:</span>
                            <span className="text-sm font-semibold">{q.stats.average.toFixed(2)}</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                            <div className="bg-primary h-3 rounded-full transition-all" style={{ width: `${(q.stats.average / 5) * 100}%` }} />
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                            <span>1</span>
                            <span>2</span>
                            <span>3</span>
                            <span>4</span>
                            <span>5</span>
                          </div>
                        </div>
                      )}
                      {q.question_type === "multiple_choice" && q.stats.distribution && (
                        <div className="space-y-1.5">
                          {Object.entries(q.stats.distribution).map(([option, count]) => (
                            <div key={option} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-24 truncate">{option}</span>
                              <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                                <div
                                  className="bg-blue-500 h-2.5 rounded-full transition-all"
                                  style={{
                                    width: `${stats.completed_count > 0 ? (count / stats.completed_count) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                              <span className="text-xs font-medium w-8 text-right">{count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {q.question_type === "short_text" && q.stats.responses && (
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {q.stats.responses.length === 0 ? (
                            <span className="text-xs text-muted-foreground">暂无回复</span>
                          ) : (
                            q.stats.responses.map((r, i) => (
                              <div key={i} className="text-sm bg-muted rounded px-2.5 py-1 text-muted-foreground">
                                {r}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title="暂无统计数据" />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex gap-3">
        <Button onClick={openNew}>
          <Plus size={16} /> 新建问卷
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm p-6">
        <div className="mb-4 rounded-xl border border-border bg-muted p-4">
          <div className="flex gap-3 flex-wrap items-end">
            <label>
              <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">问卷类型</span>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setOffset(0);
                }}
                className={inputClass}
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">共 {total} 条</span>
        </div>

        {isLoading ? (
          <LoadingState />
        ) : templates.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="暂无问卷模板" description="点击上方按钮创建第一个问卷模板" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    标题
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    类型
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    状态
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    题目数
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    回收数
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="hover:bg-muted">
                    <td className="px-4 py-3 border-b border-border font-medium">
                      {t.title}
                      {t.description && <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">{t.description}</div>}
                    </td>
                    <td className="px-4 py-3 border-b border-border">
                      <Badge variant={t.type === "pre" ? "info" : "success"}>{TYPE_LABEL[t.type] || t.type}</Badge>
                    </td>
                    <td className="px-4 py-3 border-b border-border">
                      <Badge variant={t.is_active ? "success" : "neutral"}>{t.is_active ? "启用" : "禁用"}</Badge>
                    </td>
                    <td className="px-4 py-3 border-b border-border text-muted-foreground">{t.question_count}</td>
                    <td className={cn("px-4 py-3 border-b border-border font-medium", t.response_count > 0 ? "text-primary" : "text-muted-foreground/70")}>
                      {t.response_count}
                    </td>
                    <td className="px-4 py-3 border-b border-border">
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(t)} title="编辑">
                          <Edit3 size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openAssign(t)} title="分配病例">
                          <FileText size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openStats(t)} title="查看数据">
                          <BarChart3 size={14} />
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => handleDelete(t)} title="删除">
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
      </div>

      <Modal
        open={showEditor}
        onClose={() => {
          setShowEditor(false);
          setEditingId(null);
          setForm(emptyForm());
          setEditMsg("");
        }}
        title={editingId ? "编辑问卷模板" : "新建问卷模板"}
        maxWidth={700}
      >
        {editMsg && <div className="bg-destructive/10 text-destructive px-3.5 py-2.5 rounded-lg text-sm mb-4">{editMsg}</div>}
        {isLoadingDetail && editingId ? (
          <LoadingState message="加载模板数据..." />
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">标题 *</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
                placeholder="问卷标题"
                className={inputClass}
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">类型</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className={inputClass}>
                  <option value="pre">前测 (pre)</option>
                  <option value="post">后测 (post)</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">状态</label>
                <div className="flex items-center gap-2 pt-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary" />
                  </label>
                  <span className="text-sm text-muted-foreground">{form.is_active ? "启用" : "禁用"}</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">描述</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="问卷说明（可选）"
                className={textareaClass}
              />
            </div>

            <div className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold">题目列表 ({form.questions.length})</span>
                <Button type="button" size="sm" variant="outline" onClick={addQuestion}>
                  <Plus size={14} /> 添加题目
                </Button>
              </div>

              {form.questions.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">暂无题目，点击上方按钮添加</div>
              ) : (
                <div className="space-y-3">
                  {form.questions.map((q, i) => (
                    <div key={i} className="border border-border rounded-lg p-3 bg-muted/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground">第 {i + 1} 题</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveQuestion(i, "up")}
                            disabled={i === 0}
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 cursor-pointer border-none bg-transparent"
                            title="上移"
                          >
                            <GripVertical size={14} className="text-muted-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveQuestion(i, "down")}
                            disabled={i === form.questions.length - 1}
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 cursor-pointer border-none bg-transparent"
                            title="下移"
                          >
                            <ArrowLeft size={14} className="text-muted-foreground rotate-180" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeQuestion(i)}
                            className="p-0.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 cursor-pointer border-none bg-transparent"
                            title="删除"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-3 mb-2">
                        <div className="flex-1">
                          <textarea
                            rows={2}
                            value={q.content}
                            onChange={(e) => updateQuestion(i, { content: e.target.value })}
                            placeholder="题目内容"
                            className={textareaClass}
                          />
                        </div>
                        <div className="w-40">
                          <select
                            value={q.question_type}
                            onChange={(e) => {
                              const newType = e.target.value;
                              updateQuestion(i, {
                                question_type: newType,
                                options: newType === "multiple_choice" ? q.options : [],
                              });
                            }}
                            className={inputClass}
                          >
                            {QUESTION_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                          <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(i, { required: e.target.checked })} className="rounded" />
                          必答
                        </label>
                      </div>

                      {q.question_type === "multiple_choice" && (
                        <div className="mt-2">
                          <label className="block text-xs text-muted-foreground mb-1">选项（一行一个）</label>
                          <textarea
                            rows={3}
                            value={q.options.join("\n")}
                            onChange={(e) =>
                              updateQuestion(i, {
                                options: e.target.value.split("\n").filter((s) => s.trim()),
                              })
                            }
                            placeholder="选项A&#10;选项B&#10;选项C"
                            className={textareaClass}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowEditor(false);
                  setEditingId(null);
                  setForm(emptyForm());
                  setEditMsg("");
                }}
              >
                取消
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? (
                  <>保存中...</>
                ) : (
                  <>
                    <Save size={14} /> {editingId ? "保存修改" : "创建问卷"}
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={showAssign}
        onClose={() => {
          setShowAssign(false);
          setAssignTemplate(null);
        }}
        title={`分配病例: ${assignTemplate?.title || ""}`}
        maxWidth={600}
      >
        <form onSubmit={handleAssignSubmit} className="flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted-foreground">选择病例</label>
              <div className="flex gap-2">
                <button type="button" onClick={selectAllCases} className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none">
                  全选
                </button>
                <button
                  type="button"
                  onClick={deselectAllCases}
                  className="text-xs text-muted-foreground hover:underline cursor-pointer bg-transparent border-none"
                >
                  取消全选
                </button>
              </div>
            </div>
            <div className="max-h-[300px] overflow-y-auto border border-border rounded-lg p-3 space-y-1">
              {allCases.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">暂无病例数据</div>
              ) : (
                allCases.map((c) => (
                  <label
                    key={c.id}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm cursor-pointer transition-colors",
                      assignForm.case_ids.includes(c.id) ? "bg-primary/5" : "hover:bg-muted",
                    )}
                  >
                    <input type="checkbox" checked={assignForm.case_ids.includes(c.id)} onChange={() => toggleCaseId(c.id)} className="rounded" />
                    <span className="font-medium">{c.name}</span>
                    {c.chief_complaint && <span className="text-xs text-muted-foreground truncate max-w-[200px]">— {c.chief_complaint}</span>}
                  </label>
                ))
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">已选 {assignForm.case_ids.length} 个病例</div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">触发时机</label>
              <select value={assignForm.trigger_event} onChange={(e) => setAssignForm((f) => ({ ...f, trigger_event: e.target.value }))} className={inputClass}>
                {TRIGGER_EVENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">是否必填</label>
              <div className="flex items-center gap-2 pt-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignForm.is_required}
                    onChange={(e) => setAssignForm((f) => ({ ...f, is_required: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary" />
                </label>
                <span className="text-sm text-muted-foreground">{assignForm.is_required ? "必填" : "选填"}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAssign(false);
                setAssignTemplate(null);
              }}
            >
              取消
            </Button>
            <Button type="submit" disabled={assignMutation.isPending}>
              {assignMutation.isPending ? "保存中..." : "保存分配"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
