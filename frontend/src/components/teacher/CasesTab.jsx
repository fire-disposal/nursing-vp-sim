import { ChevronDown, ChevronUp, ClipboardList, Edit3, Plus, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createCase, deleteCase, generateCase, getCaseDetail, getManageCases, updateCase } from "../../api";
import Pagination from "../Pagination";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import Modal from "../ui/Modal";

const NEW_CASE_TEMPLATE = {
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
  scoring_criteria: { 沟通技能: { max: 42, description: "", items: [] }, 病史采集: { max: 15, description: "", items: [] } },
};

function buildCaseData(form) {
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

function parseCaseData(cd) {
  const info = cd?.patient_info || {};
  return {
    name: cd?.name || "",
    time_limit: cd?.time_limit || 20,
    difficulty: cd?.difficulty || 1,
    description: cd?.description || "",
    patient_name: info.name || "",
    patient_age: info.age || 0,
    patient_gender: info.gender || "",
    chief_complaint: cd?.chief_complaint || "",
    opening_line: cd?.opening_line || "",
    present_illness: cd?.present_illness || "",
    past_history: cd?.past_history || "",
    medication_history: cd?.medication_history || "",
    allergy_history: cd?.allergy_history || "",
    family_history: cd?.family_history || "",
    social_history: cd?.social_history || "",
    communication_style: cd?.communication_style || "",
    hidden_info: cd?.hidden_info || [],
    required_inquiries: cd?.required_inquiries || [],
    scoring_criteria: cd?.scoring_criteria || {},
  };
}

export default function CasesTab() {
  const [cases, setCases] = useState([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  const [caseForm, setCaseForm] = useState(parseCaseData(NEW_CASE_TEMPLATE));
  const [caseMsg, setCaseMsg] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiMode, setAiMode] = useState("quick");
  const [aiDescription, setAiDescription] = useState("");
  const [aiReferenceCaseIds, setAiReferenceCaseIds] = useState([]);
  const [aiReferenceText, setAiReferenceText] = useState("");
  const [aiError, setAiError] = useState("");
  const toast = useToast();
  const { confirm } = useConfirm();
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;
  const [filters, setFilters] = useState({ name: "", difficulty: "" });

  const fetchCases = useCallback(
    (off) => {
      const params = { offset: off, limit: LIMIT };
      if (filters.name) params.name = filters.name;
      if (filters.difficulty) params.difficulty = filters.difficulty;
      getManageCases(params)
        .then(({ data }) => {
          setCases(data.items);
          setTotal(data.total);
        })
        .catch(() => toast.error("加载病例列表失败"));
    },
    [filters, toast],
  );

  useEffect(() => {
    fetchCases(offset);
  }, [offset, fetchCases]);

  useEffect(() => {
    setOffset(0);
  }, [filters.name, filters.difficulty]);

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

  const openEdit = (c) => {
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

  const handleSave = async (e) => {
    e.preventDefault();
    setCaseMsg("");
    const caseData = buildCaseData(caseForm);
    if (!caseData.name.trim()) {
      setCaseMsg("请输入病例名称");
      return;
    }
    try {
      if (editingCase) {
        await updateCase(editingCase.id, caseData);
      } else {
        await createCase(caseData);
      }
      setShowEditor(false);
      if (offset === 0) {
        fetchCases(0);
      } else {
        setOffset(0);
      }
    } catch (err) {
      setCaseMsg(err.response?.data?.detail || "保存失败");
    }
  };

  const handleDelete = async (c) => {
    if (c.training_count > 0) {
      toast.warning(`该病例已有 ${c.training_count} 条训练记录，无法删除`);
      return;
    }
    const ok = await confirm({ title: "删除病例", message: `确定删除病例"${c.name}"吗？`, confirmLabel: "确定删除", danger: true });
    if (!ok) return;
    try {
      await deleteCase(c.id);
      toast.success("病例已删除");
      if (offset === 0) {
        fetchCases(0);
      } else {
        setOffset(0);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "删除失败");
    }
  };

  const handleJsonImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        setCaseForm(parseCaseData(json));
        setCaseMsg("JSON 导入成功，请检查并保存");
      } catch {
        setCaseMsg("JSON 格式解析失败");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleAiGenerate = async (field) => {
    setAiError("");
    if (!field && !aiDescription.trim()) {
      setAiError("请输入病例描述");
      return;
    }
    setAiGenerating(true);
    try {
      const payload = {
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
            value = value.split("\n").filter(Boolean);
          } else {
            value = [];
          }
        } else if (field === "scoring_criteria") {
          if (typeof value === "string") {
            try {
              value = JSON.parse(value);
            } catch {
              value = {};
            }
          }
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            value = {};
          }
        }
        updateField(field, value);
        toast.success(`已生成 ${field} 建议`);
      } else {
        setCaseForm(parseCaseData(data.case_data));
        toast.success("病例生成成功，请检查并保存");
      }
    } catch (err) {
      const detail = err.response?.data?.detail || "AI 生成失败";
      setAiError(field ? `生成「${field}」失败: ${detail}` : detail);
    } finally {
      setAiGenerating(false);
    }
  };

  const updateField = (field, value) => setCaseForm((prev) => ({ ...prev, [field]: value }));
  const updateList = (field, text) => setCaseForm((prev) => ({ ...prev, [field]: text.split("\n").filter((s) => s.trim()) }));

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={16} /> 添加病例
        </button>
        <button
          className="btn"
          onClick={() => {
            openNew();
            setShowAiPanel(true);
            setAiMode("quick");
            setAiDescription("");
            setAiReferenceCaseIds([]);
            setAiReferenceText("");
            setAiError("");
          }}
          style={{
            background: "var(--purple-50)",
            border: "1px solid var(--purple-300)",
            color: "var(--purple-700)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Wand2 size={16} /> AI 生成病例
        </button>
      </div>

      <div className="card">
        <div className="filter-bar">
          <div className="filter-row">
            <div className="filter-item">
              <label>病例名称</label>
              <input placeholder="模糊搜索..." value={filters.name} onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="filter-item">
              <label>困难程度</label>
              <select value={filters.difficulty} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value }))}>
                <option value="">全部</option>
                <option value="1">初级</option>
                <option value="2">中级</option>
                <option value="3">高级</option>
              </select>
            </div>
            <div className="filter-item" style={{ alignSelf: "flex-end" }}>
              <button className="btn btn-sm" onClick={() => setFilters({ name: "", difficulty: "" })}>
                清除过滤
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" }}>共 {total} 条</span>
        </div>
        {cases.length === 0 ? (
          <div className="empty-state">
            <div className="icon">
              <ClipboardList size={42} />
            </div>
            <div>暂无病例，点击上方按钮添加</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>病例名称</th>
                <th>患者</th>
                <th>主诉</th>
                <th>时限</th>
                <th>训练次数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td>
                    {c.patient_name
                      ? `${c.patient_name}${c.patient_age ? ` · ${c.patient_age}岁` : ""}${c.patient_gender ? ` · ${c.patient_gender}` : ""}`
                      : "-"}
                  </td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.chief_complaint || "-"}</td>
                  <td>
                    <span className="badge badge-info">{c.time_limit || 20} 分钟</span>
                  </td>
                  <td style={{ color: c.training_count > 0 ? "var(--color-primary)" : "var(--text-tertiary)", fontWeight: 500 }}>{c.training_count}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-sm" onClick={() => openEdit(c)} title="编辑">
                        <Edit3 size={14} />
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(c)}
                        disabled={c.training_count > 0}
                        title={c.training_count > 0 ? "有训练记录，无法删除" : "删除"}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
      </div>

      <Modal open={showEditor} onClose={() => setShowEditor(false)} title={editingCase ? `编辑病例: ${editingCase.name}` : "添加新病例"} maxWidth={800}>
        {caseMsg && <div className={caseMsg.includes("成功") || caseMsg.includes("导入成功") ? "success-msg" : "error-msg"}>{caseMsg}</div>}
        <div style={{ marginBottom: "var(--space-4)" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setShowAiPanel(!showAiPanel);
              setAiError("");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: showAiPanel ? "var(--purple-50)" : "transparent",
              border: "1px solid var(--purple-300)",
              color: "var(--purple-700)",
            }}
          >
            <Wand2 size={14} /> {showAiPanel ? "收起 AI 面板" : "展开 AI 面板"}
          </button>
          {showAiPanel && (
            <div
              className="card"
              style={{ marginTop: "var(--space-3)", padding: "var(--space-4)", background: "var(--purple-25)", border: "1px solid var(--purple-100)" }}
            >
              <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                <button type="button" className={`btn btn-sm ${aiMode === "quick" ? "btn-primary" : ""}`} onClick={() => setAiMode("quick")}>
                  快速生成
                </button>
                <button type="button" className={`btn btn-sm ${aiMode === "reference" ? "btn-primary" : ""}`} onClick={() => setAiMode("reference")}>
                  参考资料生成
                </button>
              </div>
              <div className="form-group">
                <label>病例描述 *</label>
                <textarea
                  rows={2}
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  placeholder="一句话描述，如：糖尿病足溃疡老年患者，有10年糖尿病史..."
                />
              </div>
              {aiMode === "reference" && (
                <>
                  <div className="form-group">
                    <label>参考现有病例（多选）</label>
                    <select
                      multiple
                      value={aiReferenceCaseIds.map(String)}
                      onChange={(e) => setAiReferenceCaseIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                      style={{ minHeight: 100 }}
                    >
                      {cases.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.chief_complaint ? ` — ${c.chief_complaint}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>自由参考资料</label>
                    <textarea
                      rows={3}
                      value={aiReferenceText}
                      onChange={(e) => setAiReferenceText(e.target.value)}
                      placeholder="粘贴临床笔记、文献摘要等参考内容..."
                    />
                  </div>
                </>
              )}
              {aiError && (
                <div className="error-msg" style={{ marginBottom: "var(--space-2)" }}>
                  {aiError}
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleAiGenerate(null)}
                disabled={aiGenerating}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                {aiGenerating ? (
                  <>⟳ 生成中...</>
                ) : (
                  <>
                    <Sparkles size={14} /> 生成完整病例
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        <form onSubmit={handleSave} className="case-editor-form">
          <fieldset>
            <legend>基础信息</legend>
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>病例名称 *</label>
                <input value={caseForm.name} onChange={(e) => updateField("name", e.target.value)} required />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>训练时限 (分钟)</label>
                <input type="number" min={5} max={120} value={caseForm.time_limit} onChange={(e) => updateField("time_limit", Number(e.target.value))} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>困难程度</label>
                <select value={caseForm.difficulty} onChange={(e) => updateField("difficulty", Number(e.target.value))}>
                  <option value={1}>初级</option>
                  <option value={2}>中级</option>
                  <option value={3}>高级</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>病例描述</label>
              <input value={caseForm.description} onChange={(e) => updateField("description", e.target.value)} placeholder="一句话描述此病例的训练目标" />
            </div>
          </fieldset>
          <fieldset>
            <legend>患者信息</legend>
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>姓名</label>
                <input value={caseForm.patient_name} onChange={(e) => updateField("patient_name", e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>年龄</label>
                <input type="number" min={0} max={120} value={caseForm.patient_age} onChange={(e) => updateField("patient_age", Number(e.target.value))} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>性别</label>
                <select value={caseForm.patient_gender} onChange={(e) => updateField("patient_gender", e.target.value)}>
                  <option value="">--</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>临床信息</legend>
            <div className="form-group">
              <label>主诉</label>
              <input value={caseForm.chief_complaint} onChange={(e) => updateField("chief_complaint", e.target.value)} />
            </div>
            <div className="form-group">
              <label>开场白</label>
              <textarea rows={2} value={caseForm.opening_line} onChange={(e) => updateField("opening_line", e.target.value)} />
            </div>
            <div className="form-group">
              <label>现病史</label>
              <textarea rows={3} value={caseForm.present_illness} onChange={(e) => updateField("present_illness", e.target.value)} />
            </div>
            <div className="form-group">
              <label>既往史</label>
              <textarea rows={2} value={caseForm.past_history} onChange={(e) => updateField("past_history", e.target.value)} />
            </div>
            <div className="form-group">
              <label>用药史</label>
              <textarea rows={2} value={caseForm.medication_history} onChange={(e) => updateField("medication_history", e.target.value)} />
            </div>
            <div className="form-group">
              <label>过敏史</label>
              <input value={caseForm.allergy_history} onChange={(e) => updateField("allergy_history", e.target.value)} />
            </div>
            <div className="form-group">
              <label>家族史</label>
              <textarea rows={2} value={caseForm.family_history} onChange={(e) => updateField("family_history", e.target.value)} />
            </div>
            <div className="form-group">
              <label>社会史 / 生活习惯</label>
              <textarea rows={2} value={caseForm.social_history} onChange={(e) => updateField("social_history", e.target.value)} />
            </div>
            <div className="form-group">
              <label>沟通风格描述</label>
              <textarea rows={2} value={caseForm.communication_style} onChange={(e) => updateField("communication_style", e.target.value)} />
            </div>
          </fieldset>
          <fieldset>
            <legend>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />} 高级字段
              </button>
            </legend>
            {showAdvanced && (
              <>
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    隐藏信息（一行一条）
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("hidden_info");
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        color: "var(--purple-500)",
                        display: "flex",
                        alignItems: "center",
                      }}
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea rows={4} value={(caseForm.hidden_info || []).join("\n")} onChange={(e) => updateList("hidden_info", e.target.value)} />
                </div>
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    必须问到的内容（一行一条）
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("required_inquiries");
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        color: "var(--purple-500)",
                        display: "flex",
                        alignItems: "center",
                      }}
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea
                    rows={4}
                    value={(caseForm.required_inquiries || []).join("\n")}
                    onChange={(e) => updateList("required_inquiries", e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    评分标准 (JSON)
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("scoring_criteria");
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        color: "var(--purple-500)",
                        display: "flex",
                        alignItems: "center",
                      }}
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea
                    rows={6}
                    style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
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
              </>
            )}
          </fieldset>
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", width: "fit-content" }}>
              <Upload size={14} /> 从 JSON 文件导入
              <input type="file" accept=".json" onChange={handleJsonImport} style={{ display: "none" }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setShowEditor(false)}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              {editingCase ? "保存修改" : "创建病例"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
