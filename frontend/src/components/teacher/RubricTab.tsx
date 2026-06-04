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
      <div className="flex justify-end mb-3">
        <Button onClick={openCreate}>
          <Plus size={14} /> 新建评分标准
        </Button>
      </div>

      {rubrics.length === 0 && <div className="text-center text-gray-400 py-10">暂无评分标准</div>}

      <div className="flex flex-col gap-2">
        {rubrics.map((r) => (
          <div key={r.id} className="border border-gray-200 rounded-lg bg-white">
            <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
              <div>
                <div className="font-semibold text-sm flex items-center gap-2">
                  {r.name} <span className="text-xs text-gray-400 font-normal">v{r.version}</span>
                  {r.is_active && <span className="text-[0.625rem] bg-green-100 text-green-700 px-1.5 rounded-full">当前</span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {r.description || "无描述"} · {dimCount(r)} · 满分{r.total_max}
                </div>
              </div>
              <span className="text-gray-400">{expandedId === r.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
            </div>

            {expandedId === r.id && (
              <div className="border-t border-gray-200 px-4 py-3 bg-gray-50 rounded-b-lg">
                <div className="flex gap-1.5 mb-3">
                  {!r.is_active && (
                    <Button size="sm" onClick={() => handleActivate(r.id)}>
                      <CheckCircle size={12} /> 激活
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                  {!r.is_active && (
                    <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => setDeleteTarget(r)}>
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>

                {((r.dimensions as RubricDimension[]) || []).length === 0 ? (
                  <div className="text-gray-400 text-sm">暂无评估维度</div>
                ) : (
                  ((r.dimensions as RubricDimension[]) || []).map((dim, i) => (
                    <div key={i} className="mb-3">
                      <div className="font-semibold text-sm mb-1.5 flex items-baseline gap-2">
                        {dim.name}
                        <span className="text-xs text-gray-400 font-normal">
                          {dim.items?.length || 0}项 · 满分{dim.max}分
                        </span>
                      </div>
                      {dim.description && <div className="text-xs text-gray-500 mb-1.5">{dim.description}</div>}
                      <div className="pl-2">
                        {(dim.items || []).map((item, j) => (
                          <div key={j} className="mb-1 px-2 py-1 rounded-sm bg-white border border-gray-200">
                            <div className="text-xs font-medium mb-0.5">
                              {j + 1}. {item.name}
                            </div>
                            {item.anchors && (
                              <div className="text-xs text-gray-500 pl-2">
                                {Object.entries(item.anchors).map(([k, v]) => (
                                  <div key={k} className="mb-0.5">
                                    <span className="text-gray-400 font-medium">{k}分：</span>
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
        <div className="flex flex-col gap-2.5 max-h-[70vh] overflow-auto">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium">名称</label>
              <input
                className="w-full py-1.5 px-2.5 border border-gray-200 rounded-md bg-white text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="nursing_history_v1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">版本</label>
              <input
                className="w-20 py-1.5 px-2.5 border border-gray-200 rounded-md bg-white text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                value={formVersion}
                onChange={(e) => setFormVersion(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">描述</label>
            <input
              className="w-full py-1.5 px-2.5 border border-gray-200 rounded-md bg-white text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="简要说明该评分标准的用途"
            />
          </div>

          <div className="flex gap-3">
            <div>
              <label className="text-sm">展示满分</label>
              <input
                type="number"
                className="w-20 py-1.5 px-2.5 border border-gray-200 rounded-md bg-white text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                value={formTotalMax}
                onChange={(e) => setFormTotalMax(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-sm">原始满分</label>
              <input
                type="number"
                className="w-20 py-1.5 px-2.5 border border-gray-200 rounded-md bg-white text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                value={formRawMax}
                onChange={(e) => setFormRawMax(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-sm">原始刻度</label>
              <input
                type="number"
                className="w-20 py-1.5 px-2.5 border border-gray-200 rounded-md bg-white text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                value={formRawScale}
                onChange={(e) => setFormRawScale(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-sm font-medium">
                评估维度与条目
                <span className="font-normal text-gray-400 text-xs ml-1.5">
                  ({formDims.length}维度 · {formDims.reduce((s, d) => s + (d.items?.length || 0), 0)}条目)
                </span>
              </label>
              <div className="flex gap-1">
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
                  className="w-full font-mono text-xs py-2 px-2.5 border border-gray-200 rounded-md bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                  value={jsonText}
                  onChange={(e) => applyJsonDims(e.target.value)}
                  rows={18}
                />
              </div>
            )}
            {dimError && <div className="text-red-600 text-xs mt-1">{dimError}</div>}
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
