import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getRecordDetail } from "@/api/training";

function VitalSign({ label, value, unit }: { label: string; value: number | string | undefined | null; unit: string }) {
  return (
    <div className="flex justify-between p-2 bg-white rounded">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold">{value ?? "—"} <span className="text-gray-400 text-sm">{unit}</span></span>
    </div>
  );
}

export default function TriageScene({ recordId }: { recordId: string }) {
  const { data: record, isLoading } = useQuery({
    queryKey: ["training-record", recordId],
    queryFn: () => getRecordDetail(Number(recordId)).then((r) => r.data),
  });

  const caseData = useMemo(() => (record as Record<string, unknown>)?.case_data as Record<string, unknown> | undefined, [record]);
  const patient = useMemo(() => caseData?.patient_info as Record<string, unknown> | undefined ?? {}, [caseData]);
  const vitals = useMemo(() => caseData?.vitals as Record<string, unknown> | undefined ?? {}, [caseData]);
  const redFlags = useMemo(() => caseData?.red_flags as string[] | undefined ?? [], [caseData]);
  const chiefComplaint = useMemo(() => caseData?.chief_complaint as string | undefined ?? "", [caseData]);
  const arrivalMode = useMemo(() => caseData?.arrival_mode as string | undefined ?? "", [caseData]);

  const calculateMEWS = (vs: Record<string, unknown>) => {
    let score = 0;
    const hr = Number(vs.hr);
    const rr = Number(vs.rr);
    const temp = Number(vs.temp);
    const spo2 = Number(vs.spo2);
    if (hr > 130 || hr < 40) score += 3;
    else if (hr > 110 || hr < 50) score += 2;
    else if (hr > 100 || hr < 60) score += 1;
    if (rr > 30 || rr < 8) score += 3;
    else if (rr > 20) score += 1;
    if (temp > 39 || temp < 35) score += 2;
    else if (temp > 38.5) score += 1;
    if (spo2 < 85) score += 3;
    else if (spo2 < 90) score += 2;
    else if (spo2 < 95) score += 1;
    return Math.min(score, 14);
  };

  const [mews, setMews] = useState(0);
  const [category, setCategory] = useState("");

  const categories = [
    { id: "red", label: "红色 — 即刻", color: "bg-red-500", priority: "需立即抢救" },
    { id: "orange", label: "橙色 — 危急", color: "bg-orange-500", priority: "10分钟内处理" },
    { id: "yellow", label: "黄色 — 紧急", color: "bg-yellow-500", priority: "30分钟内处理" },
    { id: "green", label: "绿色 — 普通", color: "bg-green-500", priority: "可等待" },
    { id: "blue", label: "蓝色 — 非急", color: "bg-blue-500", priority: "可延迟" },
  ];

  const arrivalLabel = arrivalMode === "ambulance" ? "救护车" : arrivalMode === "stretcher" ? "平车" : "步行";

  if (isLoading) return <div className="flex items-center justify-center h-screen">加载中...</div>;
  if (!record) return <div className="flex items-center justify-center h-screen">训练记录不存在</div>;

  return (
    <div className="grid grid-cols-[1fr_320px] h-screen">
      <div className="flex flex-col p-6">
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <h2 className="text-xl font-bold">{patient.name as string || "未知患者"}</h2>
          <p className="text-gray-600">{patient.age as string || "?"}岁 · {patient.gender as string || "?"}</p>
          <p className="mt-2"><span className="font-semibold">主诉:</span> {chiefComplaint || "无"}</p>
          <p><span className="font-semibold">到达方式:</span> {arrivalLabel}</p>
          {redFlags.length > 0 && (
            <div className="mt-2 p-2 bg-red-50 text-red-700 rounded">
              <span className="font-semibold">⚠ 警示信号:</span> {redFlags.join("、")}
            </div>
          )}
        </div>
        <div className="flex-1 border rounded-lg p-4 bg-gray-50">
          <p className="text-gray-400 text-center mt-20">对话功能将在后续版本集成</p>
          <p className="text-gray-400 text-center">当前使用场景配置的患者信息进行评估</p>
        </div>
      </div>

      <div className="bg-gray-100 p-4 border-l overflow-y-auto">
        <h3 className="font-bold text-lg mb-3">生命体征</h3>
        <div className="space-y-2 mb-6">
          <VitalSign label="心率" value={vitals.hr as number} unit="次/分" />
          <VitalSign label="血压" value={`${vitals.bp_sys ?? "?"}/${vitals.bp_dia ?? "?"}`} unit="mmHg" />
          <VitalSign label="呼吸" value={vitals.rr as number} unit="次/分" />
          <VitalSign label="血氧" value={vitals.spo2 as number} unit="%" />
          <VitalSign label="体温" value={vitals.temp as number} unit="°C" />
          <div className="flex justify-between p-2 bg-white rounded">
            <span className="font-semibold">意识</span>
            <span>{vitals.consciousness === "alert" ? "清醒" : String(vitals.consciousness ?? "清醒")}</span>
          </div>
        </div>

        <h3 className="font-bold text-lg mb-3">MEWS 评分</h3>
        <div className="text-4xl font-bold text-center p-4 bg-white rounded-lg mb-4">
          {mews}
          <span className="text-sm font-normal text-gray-500 ml-2">/ 14</span>
        </div>
        <button
          onClick={() => setMews(calculateMEWS(vitals))}
          className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 mb-6"
        >
          重新计算
        </button>

        <h3 className="font-bold text-lg mb-3">分诊级别</h3>
        <div className="space-y-2">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`w-full p-3 rounded-lg text-left flex items-center gap-3 border-2 transition-colors ${
                category === c.id ? "border-blue-500 bg-white" : "border-transparent bg-white hover:bg-gray-50"
              }`}
            >
              <span className={`w-4 h-4 rounded-full ${c.color} flex-shrink-0`} />
              <div>
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-gray-500">{c.priority}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={async () => {
            alert(`分诊完成：${category ? categories.find(c => c.id === category)?.label : "未选择"}，MEWS: ${mews}`);
          }}
          disabled={!category}
          className="w-full mt-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          完成分诊
        </button>
      </div>
    </div>
  );
}
