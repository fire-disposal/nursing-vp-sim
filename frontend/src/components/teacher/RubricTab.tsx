import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ChevronDown, ChevronUp, Code, Layout, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { activateRubric, createRubric, deleteRubric, fetchRubrics, updateRubric } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import RubricEditor from "./RubricEditor";

type Schemas = components["schemas"];
type RubricResponse = Schemas["RubricResponse"];

interface RubricDimension {
  id?: string;
  name: string;
  max: number;
  description?: string;
  items: RubricItem[];
}

interface RubricItem {
  id?: string;
  name: string;
  anchors?: Record<string, string>;
}

function dimCount(r: RubricResponse) {
  if (!r.dimensions) return "0个维度";
  const dims = r.dimensions as RubricDimension[];
  let items = 0;
  for (const d of dims) items += (d.items || []).length;
  return `${dims.length}个维度 · ${items}项条目`;
}

export default function RubricTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: rubrics = [] } = useQuery({
    queryKey: ["rubrics"],
    queryFn: () => fetchRubrics().then((r) => r.data),
  });
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formVersion, setFormVersion] = useState("1.0");
  const [formDesc, setFormDesc] = useState("");
  const [formTotalMax, setFormTotalMax] = useState(100);
  const [formRawMax, setFormRawMax] = useState(57);
  const [formRawScale, setFormRawScale] = useState(3);
  const [formDims, setFormDims] = useState<RubricDimension[]>([]);
  const [editorMode, setEditorMode] = useState<"structured" | "json">("structured");
  const [jsonText, setJsonText] = useState("");
  const [dimError, setDimError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RubricResponse | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["rubrics"] });

  const applyStructuredDims = (dims: RubricDimension[]) => {
    setFormDims(dims);
    setJsonText(JSON.stringify(dims, null, 2));
    setDimError("");
  };

  const applyJsonDims = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        setDimError("dimensions 必须是一个数组");
        return;
      }
      setFormDims(parsed);
      setDimError("");
    } catch {
      setDimError("JSON 格式错误");
    }
  };

  const openCreate = () => {
    setEditId(null);
    setFormName("");
    setFormVersion("1.0");
    setFormDesc("");
    setFormTotalMax(100);
    setFormRawMax(57);
    setFormRawScale(3);
    applyStructuredDims([]);
    setEditorMode("structured");
    setShowModal(true);
  };

  const openEdit = (r: RubricResponse) => {
    setEditId(r.id);
    setFormName(r.name);
    setFormVersion(r.version);
    setFormDesc(r.description || "");
    setFormTotalMax(r.total_max);
    setFormRawMax(r.raw_max);
    setFormRawScale(r.raw_scale);
    const dims = (r.dimensions as RubricDimension[]) || [];
    applyStructuredDims(dims);
    setEditorMode("structured");
    setShowModal(true);
  };

  const handleSave = async () => {
    let dims: RubricDimension[];
    if (editorMode === "json") {
      try {
        dims = JSON.parse(jsonText);
      } catch {
        setDimError("JSON 格式错误");
        return;
      }
    } else {
      dims = formDims;
    }
    if (!Array.isArray(dims) || dims.length === 0) {
      setDimError("至少需要一个评估维度");
      return;
    }
    setDimError("");

    try {
      const data = {
        name: formName,
        version: formVersion,
        description: formDesc,
        total_max: formTotalMax,
        raw_max: formRawMax,
        raw_scale: formRawScale,
        dimensions: dims,
      };
      if (editId) await updateRubric(editId, data);
      else await createRubric(data);
      setShowModal(false);
      refresh();
      toast.success(editId ? "已更新" : "已创建");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "保存失败");
    }
  };

  const handleActivate = async (id: number) => {
    try {
      await activateRubric(id);
      refresh();
      toast.success("已激活");
    } catch {
      toast.error("激活失败");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRubric(deleteTarget.id);
      refresh();
      toast.success("已删除");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "删除失败");
    }
    setDeleteTarget(null);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Button onClick={openCreate}>
          <Plus size={14} /> 新建评分标准
        </Button>
      </div>

      {rubrics.length === 0 && <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: 40 }}>暂无评分标准</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rubrics.map((r) => (
          <div
            key={r.id}
            style={{
              border: "1px solid var(--border-secondary)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-primary)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                cursor: "pointer",
              }}
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
                  {r.name} <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", fontWeight: 400 }}>v{r.version}</span>
                  {r.is_active && (
                    <span
                      style={{
                        fontSize: "0.6rem",
                        background: "var(--green-100)",
                        color: "var(--green-700)",
                        padding: "0px 6px",
                        borderRadius: "var(--radius-full)",
                      }}
                    >
                      当前
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 2 }}>
                  {r.description || "无描述"} · {dimCount(r)} · 满分{r.total_max}
                </div>
              </div>
              <span style={{ color: "var(--text-tertiary)" }}>{expandedId === r.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
            </div>

            {expandedId === r.id && (
              <div
                style={{
                  borderTop: "1px solid var(--border-secondary)",
                  padding: "12px 16px",
                  background: "var(--bg-secondary)",
                }}
              >
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {!r.is_active && (
                    <Button size="sm" onClick={() => handleActivate(r.id)}>
                      <CheckCircle size={12} /> 激活
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                  {!r.is_active && (
                    <Button size="sm" variant="ghost" className="danger" onClick={() => setDeleteTarget(r)}>
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>

                {((r.dimensions as RubricDimension[]) || []).length === 0 ? (
                  <div style={{ color: "var(--text-tertiary)", fontSize: "0.8rem" }}>暂无评估维度</div>
                ) : (
                  ((r.dimensions as RubricDimension[]) || []).map((dim, i) => (
                    <div key={i} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.85rem",
                          marginBottom: 6,
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                        }}
                      >
                        {dim.name}
                        <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", fontWeight: 400 }}>
                          {dim.items?.length || 0}项 · 满分{dim.max}分
                        </span>
                      </div>
                      {dim.description && <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: 6 }}>{dim.description}</div>}
                      <div style={{ paddingLeft: 8 }}>
                        {(dim.items || []).map((item, j) => (
                          <div
                            key={j}
                            style={{
                              marginBottom: 4,
                              padding: "4px 8px",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--bg-primary)",
                              border: "1px solid var(--border-primary)",
                            }}
                          >
                            <div style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 2 }}>
                              {j + 1}. {item.name}
                            </div>
                            {item.anchors && (
                              <div style={{ fontSize: "0.68rem", color: "var(--text-secondary)", paddingLeft: 8 }}>
                                {Object.entries(item.anchors).map(([k, v]) => (
                                  <div key={k} style={{ marginBottom: 1 }}>
                                    <span style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>{k}分：</span>
                                    {String(v)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editId ? "编辑评分标准" : "新建评分标准"}
        maxWidth={720}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              取消
            </Button>
            <Button onClick={handleSave}>{editId ? "保存" : "创建"}</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "70vh", overflow: "auto" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>名称</label>
              <input
                className="form-input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="nursing_history_v1"
                style={{ width: "100%", padding: "6px 10px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>版本</label>
              <input className="form-input" value={formVersion} onChange={(e) => setFormVersion(e.target.value)} style={{ width: 80 }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>描述</label>
            <input
              className="form-input"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="简要说明该评分标准的用途"
              style={{ width: "100%", padding: "6px 10px" }}
            />
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div>
              <label style={{ fontSize: "0.8rem" }}>展示满分</label>
              <input
                type="number"
                className="form-input"
                value={formTotalMax}
                onChange={(e) => setFormTotalMax(Number(e.target.value))}
                style={{ width: 80 }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem" }}>原始满分</label>
              <input type="number" className="form-input" value={formRawMax} onChange={(e) => setFormRawMax(Number(e.target.value))} style={{ width: 80 }} />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem" }}>原始刻度</label>
              <input
                type="number"
                className="form-input"
                value={formRawScale}
                onChange={(e) => setFormRawScale(Number(e.target.value))}
                style={{ width: 80 }}
              />
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>
                评估维度与条目
                <span style={{ fontWeight: 400, color: "var(--text-tertiary)", fontSize: "0.7rem", marginLeft: 6 }}>
                  ({formDims.length}维度 · {formDims.reduce((s, d) => s + (d.items?.length || 0), 0)}条目)
                </span>
              </label>
              <div style={{ display: "flex", gap: 4 }}>
                <Button
                  size="sm"
                  variant={editorMode === "structured" ? "primary" : "ghost"}
                  onClick={() => {
                    setEditorMode("structured");
                    setDimError("");
                  }}
                >
                  <Layout size={12} /> 结构化
                </Button>
                <Button
                  size="sm"
                  variant={editorMode === "json" ? "primary" : "ghost"}
                  onClick={() => {
                    setEditorMode("json");
                    setJsonText(JSON.stringify(formDims, null, 2));
                    setDimError("");
                  }}
                >
                  <Code size={12} /> JSON
                </Button>
              </div>
            </div>

            {editorMode === "structured" ? (
              <RubricEditor dimensions={formDims} onChange={applyStructuredDims} />
            ) : (
              <div>
                <textarea
                  className="form-input"
                  value={jsonText}
                  onChange={(e) => applyJsonDims(e.target.value)}
                  rows={18}
                  style={{
                    width: "100%",
                    fontFamily: "monospace",
                    fontSize: "0.72rem",
                    padding: "8px 10px",
                  }}
                />
              </div>
            )}
            {dimError && <div style={{ color: "var(--red-600)", fontSize: "0.75rem", marginTop: 4 }}>{dimError}</div>}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        title="删除评分标准"
        message={`确定要删除「${deleteTarget?.name}」吗？`}
        danger
      />
    </div>
  );
}
