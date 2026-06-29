import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRecordDetail, submitTriage } from "@/api/training";
import LoadingState from "@/components/ui/loading-state";

const CATEGORIES = [
  { id: "red", label: "红色 — 即刻", color: "bg-red-500", priority: "需立即抢救", textColor: "text-red-700", bg: "bg-red-50" },
  { id: "orange", label: "橙色 — 危急", color: "bg-orange-500", priority: "10分钟内处理", textColor: "text-orange-700", bg: "bg-orange-50" },
  { id: "yellow", label: "黄色 — 紧急", color: "bg-yellow-500", priority: "30分钟内处理", textColor: "text-yellow-700", bg: "bg-yellow-50" },
  { id: "green", label: "绿色 — 普通", color: "bg-green-500", priority: "可等待", textColor: "text-green-700", bg: "bg-green-50" },
  { id: "blue", label: "蓝色 — 非急", color: "bg-blue-500", priority: "可延迟", textColor: "text-blue-700", bg: "bg-blue-50" },
];

const DEPARTMENTS = ["内科", "外科", "妇产科", "儿科", "急诊科", "ICU", "骨科", "神经科"];

function vitalUrgency(value: number | undefined, type: string): string {
  if (value === undefined) return "text-gray-400";
  if (type === "hr" && (value > 130 || value < 40)) return "text-red-600 font-bold";
  if (type === "hr" && (value > 110 || value < 50)) return "text-orange-600";
  if (type === "spo2" && value < 90) return "text-red-600 font-bold";
  if (type === "spo2" && value < 95) return "text-orange-600";
  if (type === "temp" && (value > 39 || value < 35)) return "text-red-600 font-bold";
  if (type === "temp" && (value > 38)) return "text-orange-600";
  return "text-gray-900";
}

export default function TriageScene({ recordId }: { recordId: string }) {
  const navigate = useNavigate();
  const [mews, setMews] = useState(0);
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data: record, isLoading } = useQuery({
    queryKey: ["training-record", recordId],
    queryFn: () => getRecordDetail(Number(recordId)).then((r) => r.data),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      submitTriage(Number(recordId), { mews_score: mews, category, department, notes }),
    onSuccess: () => setSubmitted(true),
  });

  if (isLoading) return <LoadingState message="加载训练记录..." className="h-screen" />;
  if (!record) return <div className="flex items-center justify-center h-screen">训练记录不存在</div>;

  const cd = (record as Record<string, unknown>)?.case_data as Record<string, unknown> || {};
  const patient = (cd.patient_info as Record<string, unknown>) || {};
  const vitals = (cd.vitals as Record<string, unknown>) || {};
  const arrival = cd.arrival_mode === "ambulance" ? "🚑 救护车" : cd.arrival_mode === "stretcher" ? "🛏️ 平车" : "🚶 步行";
  const redFlags = (cd.red_flags as string[]) || [];

  if (submitted) {
    const cat = CATEGORIES.find((c) => c.id === category);
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="max-w-md w-full mx-4 bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold mb-2">分诊完成</h2>
          <div className="space-y-3 mt-6 text-left">
            <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">MEWS 评分</span>
              <span className="font-bold text-lg">{mews}/14</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg" style={{ backgroundColor: cat?.bg || "#f9fafb" }}>
              <span className="text-gray-600">分诊级别</span>
              <span className={`font-bold ${cat?.textColor || "text-gray-900"}`}>{cat?.label || category}</span>
            </div>
            <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">建议科室</span>
              <span className="font-bold">{department}</span>
            </div>
          </div>
          <button onClick={() => navigate("/training")} className="mt-8 w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium">
            返回训练中心
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_340px] h-screen">
      <div className="flex flex-col p-6 overflow-y-auto">
        <h1 className="text-2xl font-bold mb-2">预检分诊</h1>
        <p className="text-muted-foreground mb-6">评估患者情况，完成分诊判定</p>

        <div className="bg-white rounded-xl border p-5 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">{String(patient.name || "未知患者")}</h2>
              <p className="text-gray-500">{String(patient.age || "?")}岁 · {String(patient.gender || "?")}</p>
            </div>
            <span className="px-3 py-1 text-sm rounded-full bg-gray-100">{arrival}</span>
          </div>
          <p className="mt-3"><span className="font-semibold">主诉:</span> {String(cd.chief_complaint || "无")}</p>
          {redFlags.length > 0 && (
            <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              <span className="font-semibold">⚠ 警示信号:</span> {redFlags.join("、")}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border p-5 mb-4">
          <h3 className="font-semibold mb-3">生命体征</h3>
          <div className="grid grid-cols-3 gap-3">
            <VitalCard label="心率" value={vitals.hr as number} unit="次/分" urgency={vitalUrgency(vitals.hr as number, "hr")} />
            <VitalCard label="血压" value={`${vitals.bp_sys || "?"}/${vitals.bp_dia || "?"}`} unit="mmHg" />
            <VitalCard label="呼吸" value={vitals.rr as number} unit="次/分" />
            <VitalCard label="血氧" value={vitals.spo2 as number} unit="%" urgency={vitalUrgency(vitals.spo2 as number, "spo2")} />
            <VitalCard label="体温" value={vitals.temp as number} unit="°C" urgency={vitalUrgency(vitals.temp as number, "temp")} />
            <VitalCard label="意识" value={vitals.consciousness === "alert" ? "清醒" : String(vitals.consciousness || "清醒")} unit="" />
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-2">备注</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="可记录分诊过程中的观察要点..."
            className="w-full h-24 p-3 border rounded-lg resize-none text-sm"
          />
        </div>
      </div>

      <div className="bg-gray-50 p-5 border-l overflow-y-auto">
        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-3">MEWS 评分</h3>
          <div className="bg-white rounded-xl p-4 text-center">
            <div className="text-5xl font-bold">{mews}
              <span className="text-lg font-normal text-gray-400 ml-1">/ 14</span>
            </div>
            <div className="flex items-center justify-center gap-4 mt-4">
              <button onClick={() => setMews(Math.max(0, mews - 1))} className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 text-xl font-bold">−</button>
              <input
                type="number" min={0} max={14} value={mews}
                onChange={(e) => setMews(Math.min(14, Math.max(0, Number(e.target.value))))}
                className="w-16 text-center text-xl font-bold border rounded-lg py-2"
              />
              <button onClick={() => setMews(Math.min(14, mews + 1))} className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 text-xl font-bold">+</button>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-3">分诊级别</h3>
          <div className="space-y-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`w-full p-3 rounded-xl text-left flex items-center gap-3 border-2 transition-all ${
                  category === c.id ? "border-gray-900 shadow-sm" : "border-transparent hover:border-gray-200"
                } ${c.bg}`}
              >
                <span className={`w-4 h-4 rounded-full ${c.color} shrink-0`} />
                <div>
                  <div className="font-medium text-sm">{c.label}</div>
                  <div className="text-xs text-gray-500">{c.priority}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-3">建议科室</h3>
          <div className="grid grid-cols-2 gap-2">
            {DEPARTMENTS.map((dep) => (
              <button
                key={dep}
                onClick={() => setDepartment(dep)}
                className={`py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-all ${
                  department === dep ? "border-blue-500 bg-blue-50 text-blue-700" : "border-transparent bg-white text-gray-600 hover:border-gray-200"
                }`}
              >
                {dep}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => submitMutation.mutate()}
          disabled={!category || !department || submitMutation.isPending}
          className="w-full py-3.5 bg-green-600 text-white rounded-xl font-semibold text-base hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {submitMutation.isPending ? "提交中..." : "完成分诊"}
        </button>
      </div>
    </div>
  );
}

function VitalCard({ label, value, unit, urgency }: { label: string; value: number | string; unit: string; urgency?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${urgency || "text-gray-900"}`}>
        {value ?? "—"}
        {unit && <span className="text-xs text-gray-400 ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}