import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ClipboardList, Edit3, Plus, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createCase, deleteCase, generateCase, getCaseDetail, getManageCases, updateCase } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";

type Schemas = components["schemas"];
type CaseManageItem = Schemas["CaseManageItem"];

interface ScoringCriteriaItem {
  name: string;
  score?: number;
  anchors?: Record<string, string>;
}

interface ScoringDimension extends Record<string, unknown> {
  name: string;
  max: number;
  description: string;
  items: ScoringCriteriaItem[];
}

interface CaseForm {
  name: string;
  time_limit: number;
  difficulty: number;
  description: string;
  patient_name: string;
  patient_age: number;
  patient_gender: string;
  chief_complaint: string;
  opening_line: string;
  present_illness: string;
  past_history: string;
  medication_history: string;
  allergy_history: string;
  family_history: string;
  social_history: string;
  communication_style: string;
  hidden_info: string[];
  required_inquiries: string[];
  scoring_criteria: Record<string, ScoringDimension>;
}

interface CaseData {
  [key: string]: unknown;
  name: string;
  time_limit: number;
  difficulty: number;
  description: string;
  patient_info?: { name: string; age: number; gender: string };
  chief_complaint: string;
  opening_line: string;
  present_illness: string;
  past_history: string;
  medication_history: string;
  allergy_history: string;
  family_history: string;
  social_history: string;
  communication_style: string;
  hidden_info: string[];
  required_inquiries: string[];
  scoring_criteria: Record<string, ScoringDimension>;
}

const NEW_CASE_TEMPLATE: CaseData = {
  name: "",
  time_limit: 20,
  difficulty: 1,
  description: "",
  patient_info: { name: "", age: 0, gender: "" },
  chief_complaint: "",
  opening_line: "",
  present_illness: "",
  past_history: "",
  medication_history: "",
  allergy_history: "",
  family_history: "",
  social_history: "",
  communication_style: "",
  hidden_info: [],
  required_inquiries: [],
  scoring_criteria: {
    沟通技能: { name: "沟通技能", max: 42, description: "", items: [] },
    病史采集: { name: "病史采集", max: 15, description: "", items: [] },
  },
};

const inputClass =
  "w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10";

const textareaClass =
  "w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 resize-y";

function buildCaseData(form: CaseForm): CaseData {
  return {
    name: form.name,
    time_limit: form.time_limit,
    difficulty: form.difficulty,
    description: form.description,
    patient_info: { name: form.patient_name, age: form.patient_age, gender: form.patient_gender },
    chief_complaint: form.chief_complaint,
    opening_line: form.opening_line,
    present_illness: form.present_illness,
    past_history: form.past_history,
    medication_history: form.medication_history,
    allergy_history: form.allergy_history,
    family_history: form.family_history,
    social_history: form.social_history,
    communication_style: form.communication_style,
    hidden_info: form.hidden_info,
    required_inquiries: form.required_inquiries,
    scoring_criteria: form.scoring_criteria,
  };
}

interface CaseJsonData {
  name?: string;
  time_limit?: number;
  difficulty?: number;
  description?: string;
  chief_complaint?: string;
  opening_line?: string;
  present_illness?: string;
  past_history?: string;
  medication_history?: string;
  allergy_history?: string;
  family_history?: string;
  social_history?: string;
  communication_style?: string;
  hidden_info?: string[];
  required_inquiries?: string[];
  scoring_criteria?: Record<string, ScoringDimension>;
  patient_info?: {
    name?: string;
    age?: number;
    gender?: string;
  };
}

function parseCaseData(cd: unknown): CaseForm {
  const rec = cd as CaseJsonData | null;
  const info = rec?.patient_info ?? {};
  return {
    name: rec?.name || "",
    time_limit: rec?.time_limit || 20,
    difficulty: rec?.difficulty || 1,
    description: rec?.description || "",
    patient_name: info.name || "",
    patient_age: info.age || 0,
    patient_gender: info.gender || "",
    chief_complaint: rec?.chief_complaint || "",
    opening_line: rec?.opening_line || "",
    present_illness: rec?.present_illness || "",
    past_history: rec?.past_history || "",
    medication_history: rec?.medication_history || "",
    allergy_history: rec?.allergy_history || "",
    family_history: rec?.family_history || "",
    social_history: rec?.social_history || "",
    communication_style: rec?.communication_style || "",
    hidden_info: rec?.hidden_info || [],
    required_inquiries: rec?.required_inquiries || [],
    scoring_criteria: rec?.scoring_criteria || {},
  };
}

export default function CasesTab() {
  const [showEditor, setShowEditor] = useState(false);
  const [_deleteTarget, _setDeleteTarget] = useState<CaseManageItem | null>(null);
  const [editingCase, setEditingCase] = useState<CaseManageItem | null>(null);
  const [caseForm, setCaseForm] = useState<CaseForm>(parseCaseData(NEW_CASE_TEMPLATE));
  const [caseMsg, setCaseMsg] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiMode, setAiMode] = useState<"quick" | "reference">("quick");
  const [aiDescription, setAiDescription] = useState("");
  const [aiReferenceCaseIds, setAiReferenceCaseIds] = useState<number[]>([]);
  const [aiReferenceText, setAiReferenceText] = useState("");
  const [aiError, setAiError] = useState("");
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;
  const [filters, setFilters] = useState({ name: "", difficulty: "" });
  const [searchText, setSearchText] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFilterName = (value: string) => {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilters((f) => ({ ...f, name: value }));
    }, 300);
  };

  const params: Record<string, unknown> = { offset, limit: LIMIT };
  if (filters.name) params.name = filters.name;
  if (filters.difficulty) params.difficulty = filters.difficulty;

  const { data: caseData } = useQuery({
    queryKey: ["manageCases", offset, filters],
    queryFn: () => getManageCases(params).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
  const cases = caseData?.items ?? [];
  const total = caseData?.total ?? 0;

  useEffect(() => {
    setOffset(0);
  }, []);

  const openNew = () => {
    setEditingCase(null);
    setCaseForm(parseCaseData(NEW_CASE_TEMPLATE));
    setCaseMsg("");
    setShowAdvanced(false);
    setShowAiPanel(false);
    setAiDescription("");
    setAiReferenceCaseIds([]);
    setAiReferenceText("");
    setAiError("");
    setShowEditor(true);
  };

  const openEdit = (c: CaseManageItem) => {
    setEditingCase(c);
    getCaseDetail(c.id)
      .then(({ data }) => setCaseForm(parseCaseData(data.case_data)))
      .catch(() => toast.error("加载病例数据失败"));
    setCaseMsg("");
    setShowAdvanced(false);
    setShowAiPanel(false);
    setAiDescription("");
    setAiReferenceCaseIds([]);
    setAiReferenceText("");
    setAiError("");
    setShowEditor(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setCaseMsg("");
    const caseData = buildCaseData(caseForm);
    if (!caseData.name.trim()) {
      setCaseMsg("请输入病例名称");
      return;
    }
    if (caseData.name.trim().length > 100) {
      setCaseMsg("病例名称不能超过100个字符");
      return;
    }
    try {
      if (editingCase) {
        await updateCase(editingCase.id, { case_data: caseData });
      } else {
        await createCase({ case_data: caseData });
      }
      setShowEditor(false);
      queryClient.invalidateQueries({ queryKey: ["manageCases"] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setCaseMsg(e.response?.data?.detail || "保存失败");
    }
  };

  const handleDelete = async (c: CaseManageItem) => {
    if (c.training_count > 0) {
      toast.warning(`该病例已有 ${c.training_count} 条训练记录，无法删除`);
      return;
    }
    const ok = await confirm({ title: "删除病例", message: `确定删除病例"${c.name}"吗？`, confirmLabel: "确定删除", danger: true });
    if (!ok) return;
    try {
      await deleteCase(c.id);
      toast.success("病例已删除");
      queryClient.invalidateQueries({ queryKey: ["manageCases"] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "删除失败");
    }
  };

  const handleJsonImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        setCaseForm(parseCaseData(json));
        setCaseMsg("JSON 导入成功，请检查并保存");
      } catch {
        setCaseMsg("JSON 格式解析失败");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleAiGenerate = async (field: string | null) => {
    setAiError("");
    if (!field && !aiDescription.trim()) {
      setAiError("请输入病例描述");
      return;
    }
    setAiGenerating(true);
    try {
      const payload: Schemas["CaseGenerateRequest"] = {
        mode: aiMode,
        description: aiDescription || caseForm.chief_complaint || caseForm.description || "护理病史采集训练病例",
        reference_case_ids: aiMode === "reference" ? aiReferenceCaseIds : undefined,
        reference_text: aiMode === "reference" && aiReferenceText ? aiReferenceText : undefined,
        field: field || null,
      };
      if (field) {
        payload.current_case_data = buildCaseData(caseForm);
      }
      const { data } = await generateCase(payload);
      if (field) {
        let value = data.field_value;
        if (field === "hidden_info" || field === "required_inquiries") {
          if (Array.isArray(value)) {
            value = value.filter(Boolean);
          } else if (typeof value === "string") {
            value = (value as string).split("\n").filter(Boolean);
          } else {
            value = [];
          }
        } else if (field === "scoring_criteria") {
          if (typeof value === "string") {
            try {
              value = JSON.parse(value as string);
            } catch {
              value = {};
            }
          }
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            value = {};
          }
        }
        updateField(field, value as string | number | string[] | Record<string, ScoringDimension>);
        toast.success(`已生成 ${field} 建议`);
      } else {
        setCaseForm(parseCaseData(data.case_data || {}));
        toast.success("病例生成成功，请检查并保存");
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      const detail = e.response?.data?.detail || "AI 生成失败";
      setAiError(field ? `生成「${field}」失败: ${detail}` : detail);
    } finally {
      setAiGenerating(false);
    }
  };

  const updateField = (field: string, value: string | number | string[] | Record<string, ScoringDimension>) =>
    setCaseForm((prev) => ({ ...prev, [field]: value }));
  const updateList = (field: string, text: string) => setCaseForm((prev) => ({ ...prev, [field]: text.split("\n").filter((s) => s.trim()) }));

  const difficultyLabel = (d: number) => (d === 1 ? "初级" : d === 2 ? "中级" : d === 3 ? "高级" : "-");

  return (
    <>
      <div className="mb-4 flex gap-3">
        <Button onClick={openNew}>
          <Plus size={16} /> 添加病例
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            openNew();
            setShowAiPanel(true);
            setAiMode("quick");
            setAiDescription("");
            setAiReferenceCaseIds([]);
            setAiReferenceText("");
            setAiError("");
          }}
          className="border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
        >
          <Wand2 size={16} /> AI 生成病例
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm p-6">
        <div className="mb-4 rounded-xl border border-border bg-muted p-4">
          <div className="flex gap-3 flex-wrap">
            <label className="flex-1 min-w-[160px]">
              <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">病例名称</span>
              <input placeholder="模糊搜索..." value={searchText || ""} onChange={(e) => setFilterName(e.target.value)} className={inputClass} />
            </label>
            <label className="flex-1 min-w-[160px]">
              <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">困难程度</span>
              <select value={filters.difficulty || ""} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value }))} className={inputClass}>
                <option value="">全部</option>
                <option value="1">初级</option>
                <option value="2">中级</option>
                <option value="3">高级</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">共 {total} 条</span>
        </div>
        {cases.length === 0 ? (
          <EmptyState icon={ClipboardList} title="暂无病例，点击上方按钮添加" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    病例名称
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    难度
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    患者
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    主诉
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    时限
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    训练次数
                  </th>
                  <th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-muted">
                    <td className="px-4 py-3 border-b border-border font-medium">{c.name}</td>
                    <td className="px-4 py-3 border-b border-border">{difficultyLabel(c.difficulty)}</td>
                    <td className="px-4 py-3 border-b border-border">
                      {c.patient_name
                        ? `${c.patient_name}${c.patient_age ? ` · ${c.patient_age}岁` : ""}${c.patient_gender ? ` · ${c.patient_gender}` : ""}`
                        : "-"}
                    </td>
                    <td className="px-4 py-3 border-b border-border max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {c.chief_complaint || "-"}
                    </td>
                    <td className="px-4 py-3 border-b border-border">
                      <Badge variant="info">{c.time_limit || 20} 分钟</Badge>
                    </td>
                    <td className={cn("px-4 py-3 border-b border-border font-medium", c.training_count > 0 ? "text-primary" : "text-muted-foreground/70")}>
                      {c.training_count}
                    </td>
                    <td className="px-4 py-3 border-b border-border">
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title="编辑">
                          <Edit3 size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDelete(c)}
                          disabled={c.training_count > 0}
                          title={c.training_count > 0 ? "有训练记录，无法删除" : "删除"}
                        >
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

      <Modal open={showEditor} onClose={() => setShowEditor(false)} title={editingCase ? `编辑病例: ${editingCase.name}` : "添加新病例"} maxWidth={800}>
        {caseMsg && (
          <div
            className={cn(
              "px-3.5 py-2.5 rounded-lg text-sm mb-4",
              caseMsg.includes("成功") || caseMsg.includes("导入成功") ? "bg-green-50 text-green-600" : "bg-destructive/10 text-red-500",
            )}
          >
            {caseMsg}
          </div>
        )}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              setShowAiPanel(!showAiPanel);
              setAiError("");
            }}
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-purple-300 transition-colors",
              showAiPanel ? "bg-purple-50 text-purple-700" : "bg-transparent text-purple-600 hover:bg-purple-50",
            )}
          >
            <Wand2 size={14} /> {showAiPanel ? "收起 AI 面板" : "展开 AI 面板"}
          </button>
          {showAiPanel && (
            <div className="mt-3 p-4 rounded-lg bg-purple-50/50 border border-purple-100">
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setAiMode("quick")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors",
                    aiMode === "quick" ? "bg-primary text-white border-blue-600" : "bg-card text-gray-600 border-border hover:bg-muted",
                  )}
                >
                  快速生成
                </button>
                <button
                  type="button"
                  onClick={() => setAiMode("reference")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors",
                    aiMode === "reference" ? "bg-primary text-white border-blue-600" : "bg-card text-gray-600 border-border hover:bg-muted",
                  )}
                >
                  参考资料生成
                </button>
              </div>
              <div className="mb-3">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">病例描述 *</label>
                <textarea
                  rows={2}
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  placeholder="一句话描述，如：糖尿病足溃疡老年患者，有10年糖尿病史..."
                  className={textareaClass}
                />
              </div>
              {aiMode === "reference" && (
                <>
                  <div className="mb-3">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">参考现有病例（多选）</label>
                    <select
                      multiple
                      value={aiReferenceCaseIds.map(String)}
                      onChange={(e) => setAiReferenceCaseIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                      className="w-full min-h-[100px] px-2.5 py-1.5 border border-border rounded-md text-sm bg-card"
                    >
                      {cases.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.chief_complaint ? ` — ${c.chief_complaint}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">自由参考资料</label>
                    <textarea
                      rows={3}
                      value={aiReferenceText}
                      onChange={(e) => setAiReferenceText(e.target.value)}
                      placeholder="粘贴临床笔记、文献摘要等参考内容..."
                      className={textareaClass}
                    />
                  </div>
                </>
              )}
              {aiError && <div className="bg-destructive/10 text-destructive px-3.5 py-2.5 rounded-lg text-sm mb-3">{aiError}</div>}
              <Button onClick={() => handleAiGenerate(null)} disabled={aiGenerating}>
                {aiGenerating ? (
                  <>⟳ 生成中...</>
                ) : (
                  <>
                    <Sparkles size={14} /> 生成完整病例
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <fieldset className="border border-border rounded-lg p-4">
            <legend className="text-sm font-semibold text-gray-700 px-1">基础信息</legend>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-[2] min-w-[200px]">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">病例名称 *</label>
                <input value={caseForm.name} onChange={(e) => updateField("name", e.target.value)} required maxLength={100} className={inputClass} />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">训练时限 (分钟)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={caseForm.time_limit}
                  onChange={(e) => updateField("time_limit", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">困难程度</label>
                <select value={caseForm.difficulty} onChange={(e) => updateField("difficulty", Number(e.target.value))} className={inputClass}>
                  <option value={1}>初级</option>
                  <option value={2}>中级</option>
                  <option value={3}>高级</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">病例描述</label>
              <input
                value={caseForm.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="一句话描述此病例的训练目标"
                className={inputClass}
              />
            </div>
          </fieldset>
          <fieldset className="border border-border rounded-lg p-4">
            <legend className="text-sm font-semibold text-gray-700 px-1">患者信息</legend>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-[2] min-w-[200px]">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">姓名</label>
                <input value={caseForm.patient_name} onChange={(e) => updateField("patient_name", e.target.value)} className={inputClass} />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">年龄</label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={caseForm.patient_age}
                  onChange={(e) => updateField("patient_age", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">性别</label>
                <select value={caseForm.patient_gender} onChange={(e) => updateField("patient_gender", e.target.value)} className={inputClass}>
                  <option value="">--</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </div>
            </div>
          </fieldset>
          <fieldset className="border border-border rounded-lg p-4">
            <legend className="text-sm font-semibold text-gray-700 px-1">临床信息</legend>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">主诉</label>
                <input value={caseForm.chief_complaint} onChange={(e) => updateField("chief_complaint", e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">开场白</label>
                <textarea rows={2} value={caseForm.opening_line} onChange={(e) => updateField("opening_line", e.target.value)} className={textareaClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">现病史</label>
                <textarea
                  rows={3}
                  value={caseForm.present_illness}
                  onChange={(e) => updateField("present_illness", e.target.value)}
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">既往史</label>
                <textarea rows={2} value={caseForm.past_history} onChange={(e) => updateField("past_history", e.target.value)} className={textareaClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">用药史</label>
                <textarea
                  rows={2}
                  value={caseForm.medication_history}
                  onChange={(e) => updateField("medication_history", e.target.value)}
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">过敏史</label>
                <input value={caseForm.allergy_history} onChange={(e) => updateField("allergy_history", e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">家族史</label>
                <textarea rows={2} value={caseForm.family_history} onChange={(e) => updateField("family_history", e.target.value)} className={textareaClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">社会史 / 生活习惯</label>
                <textarea rows={2} value={caseForm.social_history} onChange={(e) => updateField("social_history", e.target.value)} className={textareaClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">沟通风格描述</label>
                <textarea
                  rows={2}
                  value={caseForm.communication_style}
                  onChange={(e) => updateField("communication_style", e.target.value)}
                  className={textareaClass}
                />
              </div>
            </div>
          </fieldset>
          <fieldset className="border border-border rounded-lg p-4">
            <legend className="text-sm font-semibold text-gray-700 px-1">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium rounded-lg bg-transparent border-none cursor-pointer hover:bg-gray-100"
              >
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />} 高级字段
              </button>
            </legend>
            {showAdvanced && (
              <div className="flex flex-col gap-3 mt-3">
                <div>
                  <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
                    隐藏信息（一行一条）
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("hidden_info");
                      }}
                      className="bg-transparent border-none cursor-pointer p-0 text-purple-500 flex items-center"
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea
                    rows={4}
                    value={(caseForm.hidden_info || []).join("\n")}
                    onChange={(e) => updateList("hidden_info", e.target.value)}
                    className={textareaClass}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
                    必须问到的内容（一行一条）
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("required_inquiries");
                      }}
                      className="bg-transparent border-none cursor-pointer p-0 text-purple-500 flex items-center"
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea
                    rows={4}
                    value={(caseForm.required_inquiries || []).join("\n")}
                    onChange={(e) => updateList("required_inquiries", e.target.value)}
                    className={textareaClass}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
                    评分标准 (JSON)
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("scoring_criteria");
                      }}
                      className="bg-transparent border-none cursor-pointer p-0 text-purple-500 flex items-center"
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea
                    rows={6}
                    className="w-full px-2.5 py-1.5 border border-border rounded-md text-xs font-mono bg-card resize-y focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                    value={JSON.stringify(caseForm.scoring_criteria, null, 2)}
                    onChange={(e) => {
                      try {
                        updateField("scoring_criteria", JSON.parse(e.target.value));
                      } catch {
                        /* editing in progress */
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </fieldset>
          <div>
            <label className="inline-flex items-center gap-1 text-sm text-primary cursor-pointer hover:underline">
              <Upload size={14} /> 从 JSON 文件导入
              <input type="file" accept=".json" onChange={handleJsonImport} className="hidden" />
            </label>
          </div>
          <div className="flex gap-3 justify-end mt-4">
            <Button variant="outline" type="button" onClick={() => setShowEditor(false)}>
              取消
            </Button>
            <Button type="submit">{editingCase ? "保存修改" : "创建病例"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
