import { Plus, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";

interface RubricItem {
  id?: string;
  name: string;
  anchors?: Record<string, string>;
}

interface RubricDimension {
  id?: string;
  name: string;
  max: number;
  description?: string;
  items: RubricItem[];
}

interface RubricEditorProps {
  dimensions: RubricDimension[];
  onChange: (dims: RubricDimension[]) => void;
}

export default function RubricEditor({ dimensions, onChange }: RubricEditorProps) {
  const updateDim = (idx: number, patch: Partial<RubricDimension>) => {
    const next = [...dimensions];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const removeDim = (idx: number) => {
    onChange(dimensions.filter((_, i) => i !== idx));
  };

  const addDim = () => {
    onChange([...dimensions, { name: "", max: 10, description: "", items: [] }]);
  };

  const addItem = (dimIdx: number) => {
    const next = [...dimensions];
    next[dimIdx] = {
      ...next[dimIdx],
      items: [...next[dimIdx].items, { name: "", anchors: { "1": "", "2": "", "3": "" } }],
    };
    onChange(next);
  };

  const updateItem = (dimIdx: number, itemIdx: number, patch: Partial<RubricItem>) => {
    const next = [...dimensions];
    const items = [...next[dimIdx].items];
    items[itemIdx] = { ...items[itemIdx], ...patch };
    next[dimIdx] = { ...next[dimIdx], items };
    onChange(next);
  };

  const removeItem = (dimIdx: number, itemIdx: number) => {
    const next = [...dimensions];
    next[dimIdx] = { ...next[dimIdx], items: next[dimIdx].items.filter((_, i) => i !== itemIdx) };
    onChange(next);
  };

  const updateAnchor = (dimIdx: number, itemIdx: number, score: string, value: string) => {
    const next = [...dimensions];
    const items = [...next[dimIdx].items];
    items[itemIdx] = {
      ...items[itemIdx],
      anchors: { ...items[itemIdx].anchors, [score]: value },
    };
    next[dimIdx] = { ...next[dimIdx], items };
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {dimensions.map((dim, di) => (
        <div
          key={di}
          style={{
            border: "1px solid var(--border-secondary)",
            borderRadius: "var(--radius-md)",
            padding: 12,
            background: "var(--bg-secondary)",
          }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input
              className="form-input"
              placeholder="维度名称"
              value={dim.name}
              onChange={(e) => updateDim(di, { name: e.target.value })}
              style={{ flex: 1, fontWeight: 600, padding: "4px 8px" }}
            />
            <label style={{ fontSize: "0.7rem", whiteSpace: "nowrap" }}>
              满分
              <input
                type="number"
                className="form-input"
                value={dim.max}
                onChange={(e) => updateDim(di, { max: Number(e.target.value) || 0 })}
                style={{ width: 56, marginLeft: 4, padding: "4px" }}
              />
            </label>
            <Button size="sm" variant="ghost" className="danger" onClick={() => removeDim(di)} title="删除此维度">
              <Trash2 size={12} />
            </Button>
          </div>
          <input
            className="form-input"
            placeholder="维度描述（可选）"
            value={dim.description || ""}
            onChange={(e) => updateDim(di, { description: e.target.value })}
            style={{ width: "100%", marginBottom: 8, padding: "4px 8px", fontSize: "0.72rem" }}
          />

          <div style={{ paddingLeft: 8 }}>
            {dim.items.map((item, ii) => (
              <div
                key={ii}
                style={{
                  marginBottom: 8,
                  padding: 8,
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-primary)",
                }}
              >
                <div style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-tertiary)" }}>{ii + 1}</span>
                  <input
                    className="form-input"
                    placeholder="条目名称"
                    value={item.name}
                    onChange={(e) => updateItem(di, ii, { name: e.target.value })}
                    style={{ flex: 1, padding: "3px 6px", fontSize: "0.75rem" }}
                  />
                  <Button size="sm" variant="ghost" className="danger" onClick={() => removeItem(di, ii)} title="删除此条目">
                    <Trash2 size={11} />
                  </Button>
                </div>
                {["1", "2", "3"].map((score) => (
                  <div key={score} style={{ display: "flex", gap: 6, marginBottom: 2, alignItems: "center" }}>
                    <span style={{ fontSize: "0.6rem", color: "var(--text-tertiary)", width: 28, textAlign: "right" }}>{score}分</span>
                    <input
                      className="form-input"
                      placeholder={`${score}分锚点描述`}
                      value={item.anchors?.[score] || ""}
                      onChange={(e) => updateAnchor(di, ii, score, e.target.value)}
                      style={{ flex: 1, padding: "2px 6px", fontSize: "0.7rem" }}
                    />
                  </div>
                ))}
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => addItem(di)}>
              <Plus size={11} /> 添加条目
            </Button>
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={addDim} style={{ alignSelf: "flex-start" }}>
        <Plus size={12} /> 添加维度
      </Button>
    </div>
  );
}
