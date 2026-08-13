import { IconAlertCircle, IconLoader2, IconWifiOff } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Group, Text } from "@mantine/core";
import { type MonitorStatus, PatientMonitor } from "@/components/training/PatientMonitor";
import type { SceneState } from "@/engine/scene-state";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { useSceneStateValue } from "@/engine/useSceneBus";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";

const MEASURE_TIMEOUT_MS = 10000;

const NORMALS: Record<string, { label: string; unit: string; normal: string; cat: string }> = {
  temp:  { label: "体温",      unit: "°C",    normal: "36.8",   cat: "vital" },
  hr:    { label: "心率",      unit: "次/分", normal: "76",     cat: "vital" },
  rr:    { label: "呼吸频率",   unit: "次/分", normal: "18",     cat: "vital" },
  bp:    { label: "血压",      unit: "mmHg",  normal: "120/80", cat: "vital" },
  spo2:  { label: "血氧饱和度", unit: "%",     normal: "98",     cat: "vital" },
  pain:  { label: "疼痛评分",   unit: "/10",   normal: "0",      cat: "vital" },
  skin:  { label: "皮肤检查",   unit: "",      normal: "未见异常", cat: "inspection" },
};

const CAT_COLOR: Record<string, string> = { vital: "#4fc3f7", inspection: "#7c4dff" };

interface ExamResultState {
	value: string;
	/** 与参考范围对照：normal | high | low（后端 interpretation.status，持久化） */
	status?: string;
	/** 解读文案（仅实时测量返回，引导模式展示） */
	interpretation?: string;
}

const STATUS_LABEL: Record<string, string> = { high: "偏高", low: "偏低" };

interface Part { id: string; label: string; x: number; y: number; w: number; h: number; ops: string[] }
const PARTS: Part[] = [
  { id: "head",    label: "头部",   x: 38, y: 2,  w: 24, h: 18, ops: ["temp","pain"] },
  { id: "chest",   label: "胸部",   x: 30, y: 24, w: 40, h: 26, ops: ["hr","rr","spo2", "skin"] },
  { id: "arm_l",   label: "左上肢", x: 8,  y: 26, w: 18, h: 36, ops: ["bp"] },
  { id: "arm_r",   label: "右上肢", x: 74, y: 26, w: 18, h: 36, ops: ["bp","skin"] },
  { id: "abdomen", label: "腹部",   x: 34, y: 52, w: 32, h: 18, ops: ["pain"] },
  { id: "leg_l",   label: "左下肢", x: 22, y: 72, w: 22, h: 26, ops: ["skin"] },
  { id: "leg_r",   label: "右下肢", x: 56, y: 72, w: 22, h: 26, ops: ["skin"] },
];

function groupByCat(ops: string[]): [string, string[]][] {
  const m = new Map<string, string[]>();
  for (const id of ops) {
    const c = NORMALS[id]?.cat ?? "other";
    if (!m.has(c)) m.set(c, []);
    m.get(c)!.push(id);
  }
  return [...m.entries()];
}

function classify(v: SceneState["vitals"]): MonitorStatus {
  return {
    hr: !v?.hr ? "normal" : v.hr > 100 ? "tachycardia" : v.hr < 55 ? "bradycardia" : "normal",
    spo2: !v?.spo2 ? "normal" : v.spo2 < 90 ? "critical" : v.spo2 < 95 ? "low" : "normal",
    bp: !v?.bp_sys ? "normal" : v.bp_sys > 160 ? "hypertensive" : v.bp_sys > 130 ? "elevated" : "normal",
    rr: !v?.rr ? "normal" : v.rr > 24 ? "tachypnea" : v.rr < 10 ? "bradypnea" : "normal",
    temp: !v?.temp ? "normal" : v.temp > 38 ? "fever" : v.temp < 36 ? "hypothermia" : "normal",
    pain: !v?.pain ? "none" : v.pain > 7 ? "severe" : v.pain > 4 ? "moderate" : v.pain > 0 ? "mild" : "none",
  };
}

export default function PhysicalExamTool(props: TrainingToolProps) {
  const { bus, recordId, recordDetail } = props;
  const rid = Number(recordId);
  const sceneState = useSceneStateValue();
  const status = classify(sceneState.vitals);
  const [results, setResults] = useState<Record<string, ExamResultState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pendingOps, setPendingOps] = useState<Set<string>>(new Set());
  const [opErrors, setOpErrors] = useState<Record<string, string>>({});
  const [wsConnected, setWsConnected] = useState(true);
  const measureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenConnected = useRef(false);
  useEffect(() => subscribeWSConnection((c) => {
    if (c) { seenConnected.current = true; setWsConnected(true); }
    else if (seenConnected.current) setWsConnected(false);
  }), []);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !recordDetail) return;
    const prior = recordDetail.exam_results;
    if (Array.isArray(prior) && prior.length > 0) {
      const seeded: Record<string, ExamResultState> = {};
      for (const e of prior) {
        if (e?.type) seeded[e.type] = { value: String(e.value ?? ""), status: typeof e.status === "string" ? e.status : undefined };
      }
      setResults(seeded);
    }
    seededRef.current = true;
  }, [recordDetail]);

  useEffect(() => {
    const onToolResult = (payload: { tool: string; action: string; ok: boolean; data: Record<string, unknown>; error?: string }) => {
      if (payload.tool !== "physical_exam" || payload.action !== "measure") return;
      const data = payload.data as { op_type?: string; result?: { label?: string; value?: string; unit?: string; interpretation?: { status?: string; text?: string } } };
      const opType = data.op_type;
      if (!opType) return;
      if (measureTimerRef.current) { clearTimeout(measureTimerRef.current); measureTimerRef.current = null; }
      setPendingOps((prev) => { const n = new Set(prev); n.delete(opType); return n; });
      if (payload.ok) {
        const resultValue = data.result?.value;
        if (resultValue) {
          setResults((prev) => ({
            ...prev,
            [opType]: {
              value: resultValue,
              status: data.result?.interpretation?.status,
              interpretation: data.result?.interpretation?.text,
            },
          }));
        }
        setOpErrors((prev) => { const n = { ...prev }; delete n[opType]; return n; });
      } else {
        setOpErrors((prev) => ({ ...prev, [opType]: payload.error || "检查失败" }));
      }
    };
    bus.on("tool:result", onToolResult);
    return () => {
      bus.off("tool:result", onToolResult);
      if (measureTimerRef.current) clearTimeout(measureTimerRef.current);
    };
  }, [bus]);

  const interact = useCallback((opId: string) => {
    if (!NORMALS[opId]) return;
    if (!wsConnected) {
      setOpErrors((prev) => ({ ...prev, [opId]: "实时连接中断，请检查网络" }));
      return;
    }
    setFlash(opId);
    setOpErrors((prev) => { const n = { ...prev }; delete n[opId]; return n; });
    if (rid > 0) {
      setPendingOps((prev) => { const n = new Set(prev); n.add(opId); return n; });
      if (measureTimerRef.current) clearTimeout(measureTimerRef.current);
      measureTimerRef.current = setTimeout(() => {
        setPendingOps((prev) => { const n = new Set(prev); n.delete(opId); return n; });
        setOpErrors((prev) => ({ ...prev, [opId]: "检查超时，请重试" }));
      }, MEASURE_TIMEOUT_MS);
      bus.emit("tool:invoke", { tool: "physical_exam", action: "measure", params: { op_type: opId }, recordId: rid });
    }
    setSelected(null);
    setTimeout(() => setFlash(null), 350);
  }, [rid, bus, wsConnected]);

  const errorCount = Object.keys(opErrors).length;

  // ── 对照着色 + 异常汇总 + 解读（引导模式） ──
  const mode = recordDetail?.mode ?? "guided";
  const isGuided = mode === "guided";
  const abnormal = Object.entries(results).filter(([, r]) => r.status === "high" || r.status === "low");
  const hints = abnormal.filter(([, r]) => r.interpretation && isGuided);

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--mantine-color-body)" }}>
      <Box px={8} pt={8} style={{ flexShrink: 0 }}>
        {!wsConnected && (
          <Group gap={6} mb={4} px={4} wrap="nowrap">
            <IconWifiOff size={12} style={{ color: "var(--mantine-color-yellow-7)" }} />
            <Text size="11px" c="yellow.7">实时连接中断，检查结果可能延迟</Text>
          </Group>
        )}
        <PatientMonitor status={status} vitals={sceneState.vitals} />
      </Box>

      <Box style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 280 }}>
        <Box
          style={{
            position: "relative",
            width: "50%",
            maxWidth: 280,
            aspectRatio: "0.48",
            background: "var(--mantine-color-gray-1)",
            borderRadius: "60px 60px 30px 30px",
            border: "2px solid var(--mantine-color-default-border)",
          }}
        >
          {PARTS.map((part) => {
            const sel = selected === part.id;
            const measured = part.ops.some((op) => results[op]);
            return (
              <Box key={part.id}>
                <Box
                  onClick={() => setSelected(sel ? null : part.id)}
                  onMouseEnter={(e) => { if (!sel) { e.currentTarget.style.borderColor = "var(--mantine-color-default-border)"; e.currentTarget.style.background = "var(--mantine-primary-color-light)"; }}}
                  onMouseLeave={(e) => { if (!sel) { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; }}}
                  style={{
                    position: "absolute",
                    left: `${part.x}%`,
                    top: `${part.y}%`,
                    width: `${part.w}%`,
                    height: `${part.h}%`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 10,
                    fontWeight: 500,
                    border: "1px solid transparent",
                    transition: "all 150ms",
                    background: sel
                      ? "var(--mantine-primary-color-light)"
                      : measured
                        ? "var(--mantine-color-green-0)"
                        : "transparent",
                    borderColor: sel
                      ? "var(--mantine-primary-color-4)"
                      : measured
                        ? "var(--mantine-color-green-4)"
                        : "transparent",
                    color: sel
                      ? "var(--mantine-primary-color-light-color)"
                      : measured
                        ? "var(--mantine-color-green-9)"
                        : "var(--mantine-color-dimmed)",
                  }}
                >
                  {part.label}
                  {measured && (
                    <Box w={6} h={6} style={{ position: "absolute", top: -2, right: -2, borderRadius: 999, background: "var(--mantine-color-green-5)" }} />
                  )}
                </Box>

                {sel && (
                  <Box
                    style={{
                      position: "absolute",
                      left: `${part.x + part.w / 2}%`,
                      top: `${part.y + part.h / 2}%`,
                      transform: "translate(-50%, -50%)",
                      minWidth: 160,
                      zIndex: 10,
                      background: "var(--mantine-color-body)",
                      border: "1px solid var(--mantine-color-default-border)",
                      borderRadius: 12,
                      boxShadow: "var(--mantine-shadow-lg)",
                      padding: 8,
                    }}
                  >
                    {groupByCat(part.ops).map(([cat, ids]) => (
                      <Box key={cat} mb={6} style={{ marginBottom: 6 }}>
                        <Text size="9px" c="dimmed" mb={4} fw={600} tt="uppercase" style={{ letterSpacing: "0.05em" }}>{cat}</Text>
                        <Group gap={4} wrap="wrap">
                          {ids.map((id) => {
                            const def = NORMALS[id];
                            if (!def) return null;
                            const done = results[id];
                            const pending = pendingOps.has(id);
                            return (
                              <Box
                                key={id}
                                component="button"
                                type="button"
                                onClick={() => interact(id)}
                                disabled={pending}
                                px={8}
                                py={2}
                                style={{
                                  fontSize: 10,
                                  whiteSpace: "nowrap",
                                  cursor: pending ? "wait" : "pointer",
                                  borderRadius: 4,
                                  border: "1px solid var(--mantine-color-default-border)",
                                  background: flash === id
                                    ? (CAT_COLOR[def.cat] ?? "#888")
                                    : done
                                      ? "var(--mantine-color-green-0)"
                                      : "var(--mantine-color-gray-1)",
                                  color: done ? "var(--mantine-color-green-9)" : "var(--mantine-color-dimmed)",
                                  opacity: pending ? 0.5 : 1,
                                }}
                              >
                                {pending ? <IconLoader2 size={10} className="animate-spin" style={{ display: "inline", marginRight: 2 }} /> : null}
                                {def.label}
                                {done && (
                                  <Text component="span" fw={700} ml={2} c="green.7">{done.value}{def.unit}</Text>
                                )}
                              </Box>
                            );
                          })}
                        </Group>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box style={{ borderTop: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-body)", flexShrink: 0 }}>
        {abnormal.length > 0 && (
          <Group gap={6} px={8} pt={8} wrap="wrap">
            <Text size="10px" fw={600} c="red.6" style={{ flexShrink: 0 }}>异常发现</Text>
            {abnormal.map(([id, r]) => {
              const def = NORMALS[id];
              if (!def) return null;
              return (
                <Box
                  key={`ab-${id}`}
                  px={8}
                  py={2}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    borderRadius: 4,
                    background: "var(--mantine-color-red-0)",
                    color: "var(--mantine-color-red-9)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {def.label} {r.value}{def.unit}
                  <Text component="span" opacity={0.8}>{STATUS_LABEL[r.status ?? ""] ?? ""}</Text>
                </Box>
              );
            })}
          </Group>
        )}
        {isGuided && hints.length > 0 && (
          <Box px={8} pt={6}>
            {hints.map(([id, r]) => (
              <Text key={`hint-${id}`} size="10px" c="dimmed" lh={1.4} mb={2}>
                {r.interpretation}
              </Text>
            ))}
          </Box>
        )}
        <Group gap={6} px={8} py={8} wrap="nowrap" style={{ overflowX: "auto" }}>
        {Object.keys(results).length === 0 && errorCount === 0 ? (
          <Text size="xs" c="dimmed" px={4} py={4}>点击人体部位选择检查项目</Text>
        ) : (
          <>
            {Object.entries(results).map(([id, r]) => {
              const def = NORMALS[id];
              if (!def) return null;
              const isPending = pendingOps.has(id);
              const isError = opErrors[id];
              const chipBg = isError
                ? "var(--mantine-color-red-0)"
                : isPending
                  ? "var(--mantine-color-blue-0)"
                  : r.status === "high" || r.status === "low"
                    ? "var(--mantine-color-red-0)"
                    : "var(--mantine-color-gray-1)";
              const chipFg = isError
                ? "var(--mantine-color-red-9)"
                : isPending
                  ? "var(--mantine-color-blue-7)"
                  : r.status === "high" || r.status === "low"
                    ? "var(--mantine-color-red-9)"
                    : "var(--mantine-color-dimmed)";
              return (
                <Box
                  key={id}
                  title={r.interpretation ?? undefined}
                  px={8}
                  py={4}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    borderRadius: 4,
                    background: chipBg,
                    color: chipFg,
                  }}
                >
                  <Box w={6} h={6} style={{ borderRadius: 999, flexShrink: 0, background: isError ? "#ef4444" : isPending ? "#3b82f6" : (CAT_COLOR[def.cat] ?? "#888") }} />
                  {def.label}{" "}
                  {isPending ? <IconLoader2 size={10} className="animate-spin" /> : <Text component="span" fw={600} style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{r.value}</Text>}
                  {def.unit && !isPending && <Text component="span" opacity={0.7}>{def.unit}</Text>}
                  {isError && <IconAlertCircle size={10} />}
                </Box>
              );
            })}
            {Object.entries(opErrors).filter(([id]) => !results[id]).map(([id, err]) => (
              <Box key={`err-${id}`} px={8} py={4} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, borderRadius: 4, background: "var(--mantine-color-red-0)", color: "var(--mantine-color-red-9)", flexShrink: 0 }}>
                <IconAlertCircle size={10} />
                {NORMALS[id]?.label ?? id}: {err}
              </Box>
            ))}
          </>
        )}
        </Group>
      </Box>
    </Box>
  );
}
