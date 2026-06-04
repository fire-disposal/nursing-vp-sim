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
    <div className="flex flex-col gap-3">
      {dimensions.map((dim, di) => (
        <div key={di} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
          <div className="flex gap-2 mb-2 items-center">
            <input
              className="w-full h-9 border border-gray-200 rounded-md bg-white px-2.5 text-sm font-[inherit] text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 flex-1 font-semibold !py-1 !px-2 !h-auto"
              placeholder="维度名称"
              value={dim.name}
              onChange={(e) => updateDim(di, { name: e.target.value })}
            />
            <label className="text-xs whitespace-nowrap">
              满分
              <input
                type="number"
                className="w-14 ml-1 p-1 h-7 border border-gray-200 rounded-md bg-white text-sm font-[inherit] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                value={dim.max}
                onChange={(e) => updateDim(di, { max: Number(e.target.value) || 0 })}
              />
            </label>
            <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => removeDim(di)} title="删除此维度">
              <Trash2 size={12} />
            </Button>
          </div>
          <input
            className="w-full h-7 mb-2 !py-1 !px-2 text-xs border border-gray-200 rounded-md bg-white font-[inherit] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
            placeholder="维度描述（可选）"
            value={dim.description || ""}
            onChange={(e) => updateDim(di, { description: e.target.value })}
          />

          <div className="pl-2">
            {dim.items.map((item, ii) => (
              <div key={ii} className="mb-2 p-2 border border-gray-200 rounded-sm bg-white">
                <div className="flex gap-1.5 mb-1 items-center">
                  <span className="text-xs text-gray-400">{ii + 1}</span>
                  <input
                    className="flex-1 !py-0.5 !px-1.5 text-xs h-7 border border-gray-200 rounded-md bg-white font-[inherit] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                    placeholder="条目名称"
                    value={item.name}
                    onChange={(e) => updateItem(di, ii, { name: e.target.value })}
                  />
                  <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => removeItem(di, ii)} title="删除此条目">
                    <Trash2 size={11} />
                  </Button>
                </div>
                {["1", "2", "3"].map((score) => (
                  <div key={score} className="flex gap-1.5 mb-0.5 items-center">
                    <span className="text-[0.625rem] text-gray-400 w-7 text-right">{score}分</span>
                    <input
                      className="flex-1 !py-0.5 !px-1.5 text-xs h-7 border border-gray-200 rounded-md bg-white font-[inherit] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                      placeholder={`${score}分锚点描述`}
                      value={item.anchors?.[score] || ""}
                      onChange={(e) => updateAnchor(di, ii, score, e.target.value)}
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

      <Button variant="outline" size="sm" onClick={addDim} className="self-start">
        <Plus size={12} /> 添加维度
      </Button>
    </div>
  );
}
