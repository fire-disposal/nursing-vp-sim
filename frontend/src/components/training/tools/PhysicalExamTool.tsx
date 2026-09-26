import {
	IconAlertCircle,
	IconCheck,
	IconLoader2,
	IconRefresh,
	IconStethoscope,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Button, Group, Progress, ScrollArea, Stack, Text, ThemeIcon } from "@mantine/core";
import type { ActivityPanelProps } from "@/components/training/workspace/contract";

const MEASURE_TIMEOUT_MS = 10_000;

type ExamCategory = "vital" | "inspection";

interface ExamDefinition {
	label: string;
	unit: string;
	category: ExamCategory;
}

const EXAMS: Record<string, ExamDefinition> = {
	temp: { label: "体温", unit: "°C", category: "vital" },
	hr: { label: "心率", unit: "次/分", category: "vital" },
	rr: { label: "呼吸频率", unit: "次/分", category: "vital" },
	bp: { label: "血压", unit: "mmHg", category: "vital" },
	spo2: { label: "血氧饱和度", unit: "%", category: "vital" },
	pain: { label: "疼痛评分", unit: "/10", category: "vital" },
	skin: { label: "皮肤检查", unit: "", category: "inspection" },
};

interface ExamRegion {
	id: string;
	label: string;
	ops: string[];
}

const REGIONS: ExamRegion[] = [
	{ id: "head", label: "头部", ops: ["temp", "pain"] },
	{ id: "chest", label: "胸部", ops: ["hr", "rr", "spo2", "skin"] },
	{ id: "arm_l", label: "左上肢", ops: ["bp"] },
	{ id: "arm_r", label: "右上肢", ops: ["bp", "skin"] },
	{ id: "abdomen", label: "腹部", ops: ["pain"] },
	{ id: "leg_l", label: "左下肢", ops: ["skin"] },
	{ id: "leg_r", label: "右下肢", ops: ["skin"] },
];

const CATEGORY_LABEL: Record<ExamCategory, string> = {
	vital: "生命体征",
	inspection: "视诊",
};

const STATUS_LABEL: Record<string, string> = {
	high: "偏高",
	low: "偏低",
	normal: "正常",
};

interface ExamResultState {
	value: string;
	status?: string;
	interpretation?: string;
}

function isAbnormal(result: ExamResultState): boolean {
	return result.status === "high" || result.status === "low";
}

export default function PhysicalExamTool({ activity, bus, recordId, recordDetail }: ActivityPanelProps) {
	/** 命令命名空间来自 manifest 的 activity 定义 */
	const command = activity.id;
	const rid = Number(recordId);
	const [results, setResults] = useState<Record<string, ExamResultState>>({});
	const [selectedRegionId, setSelectedRegionId] = useState("chest");
	const [pendingOp, setPendingOp] = useState<string | null>(null);
	const [opErrors, setOpErrors] = useState<Record<string, string>>({});
	const measureTimerRef = useRef<number | undefined>(undefined);
	const seededRef = useRef(false);

	useEffect(() => {
		if (seededRef.current || !recordDetail) return;
		const prior = recordDetail.exam_results;
		if (Array.isArray(prior)) {
			const seeded: Record<string, ExamResultState> = {};
			for (const raw of prior) {
				if (!raw || typeof raw !== "object") continue;
				const type = "type" in raw && typeof raw.type === "string" ? raw.type : null;
				if (!type || !EXAMS[type]) continue;
				const value = "value" in raw ? String(raw.value ?? "") : "";
				const status = "status" in raw && typeof raw.status === "string" ? raw.status : undefined;
				const interpretation =
					"interpretation" in raw && typeof raw.interpretation === "string" ? raw.interpretation : undefined;
				seeded[type] = { value, status, interpretation };
			}
			setResults(seeded);
		}
		seededRef.current = true;
	}, [recordDetail]);

	useEffect(() => {
		const onToolResult = (payload: {
			tool: string;
			action: string;
			ok: boolean;
			data: Record<string, unknown>;
			error?: string;
		}) => {
			if (payload.tool !== command || payload.action !== "measure") return;
			const data = payload.data as {
				op_type?: string;
				result?: {
					value?: string;
					interpretation?: { status?: string; text?: string };
				};
			};
			const opType = data.op_type;
			if (!opType || !EXAMS[opType]) return;
			clearTimeout(measureTimerRef.current);
			measureTimerRef.current = undefined;
			setPendingOp((current) => (current === opType ? null : current));
			if (payload.ok && data.result?.value !== undefined) {
				setResults((current) => ({
					...current,
					[opType]: {
						value: data.result?.value ?? "",
						status: data.result?.interpretation?.status,
						interpretation: data.result?.interpretation?.text,
					},
				}));
				setOpErrors((current) => {
					const next = { ...current };
					delete next[opType];
					return next;
				});
			} else {
				setOpErrors((current) => ({
					...current,
					[opType]: payload.error || "检查失败，请重试",
				}));
			}
		};
		const unsubscribe = bus.on("tool:result", onToolResult);
		return () => {
			unsubscribe();
			clearTimeout(measureTimerRef.current);
		};
	}, [bus, command]);

	const interact = useCallback(
		(opId: string) => {
			if (!EXAMS[opId] || pendingOp || rid <= 0) return;
			setPendingOp(opId);
			setOpErrors((current) => {
				const next = { ...current };
				delete next[opId];
				return next;
			});
			clearTimeout(measureTimerRef.current);
			measureTimerRef.current = window.setTimeout(() => {
				setPendingOp((current) => (current === opId ? null : current));
				setOpErrors((current) => ({ ...current, [opId]: "检查超时，请重试" }));
			}, MEASURE_TIMEOUT_MS);
			bus.emit("tool:invoke", {
				tool: command,
				action: "measure",
				params: { op_type: opId },
				recordId: rid,
			});
		},
		[bus, command, pendingOp, rid],
	);

	const selectedRegion = REGIONS.find((region) => region.id === selectedRegionId) ?? REGIONS[0];
	const measuredIds = Object.keys(results).filter((id) => EXAMS[id]);
	const abnormalResults = useMemo(
		() => Object.entries(results).filter(([, result]) => isAbnormal(result)),
		[results],
	);
	const isGuided = (recordDetail?.mode ?? "guided") === "guided";
	const completion = Math.round((measuredIds.length / Object.keys(EXAMS).length) * 100);

	return (
		<Box
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				background: "var(--mantine-color-body)",
			}}
		>
			<Stack gap={8} px="sm" py="sm" style={{ flexShrink: 0, borderBottom: "1px solid var(--mantine-color-default-border)" }}>
				<Group justify="space-between" wrap="nowrap">
					<Group gap={8} wrap="nowrap">
						<ThemeIcon variant="light" size="md" radius="md">
							<IconStethoscope size={16} />
						</ThemeIcon>
						<Box>
							<Text size="sm" fw={600}>选择部位，再执行检查</Text>
							<Text size="xs" c="dimmed">结果自动写入本次训练记录</Text>
						</Box>
					</Group>
					<Badge variant="light" color={measuredIds.length > 0 ? "teal" : "gray"}>
						{measuredIds.length}/{Object.keys(EXAMS).length}
					</Badge>
				</Group>
				<Progress value={completion} size="xs" radius="xl" color="teal" aria-label="查体完成进度" />
				{!isGuided && (
					<Text size="xs" c="dimmed">
						当前模式仅展示检查结果，不提供参考范围解读。
					</Text>
				)}
			</Stack>

			<Box px="sm" py={8} style={{ flexShrink: 0, borderBottom: "1px solid var(--mantine-color-default-border)" }}>
				<Group gap={6} wrap="wrap" role="group" aria-label="查体部位">
					{REGIONS.map((region) => {
						const measured = region.ops.filter((op) => results[op]).length;
						const selected = region.id === selectedRegion.id;
						return (
							<Button
								key={region.id}
								size="compact-xs"
								variant={selected ? "filled" : "default"}
								color={selected ? "blue" : "gray"}
								onClick={() => setSelectedRegionId(region.id)}
								aria-pressed={selected}
							>
								{region.label}
								{measured > 0 && (
									<Text component="span" size="xs" ml={4} opacity={0.8}>
										{measured}
									</Text>
								)}
							</Button>
						);
					})}
				</Group>
			</Box>

			<ScrollArea style={{ flex: 1 }} type="auto">
				<Stack gap="sm" p="sm">
					<Box>
						<Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={6}>
							{selectedRegion.label}检查项目
						</Text>
						<Stack gap={8}>
							{selectedRegion.ops.map((opId) => {
								const definition = EXAMS[opId];
								const result = results[opId];
								const error = opErrors[opId];
								const pending = pendingOp === opId;
								const abnormal = result ? isAbnormal(result) : false;
								return (
									<Box
										key={opId}
										p="sm"
										style={{
											border: `1px solid ${abnormal ? "var(--mantine-color-red-3)" : "var(--mantine-color-default-border)"}`,
											borderRadius: "var(--mantine-radius-md)",
											background: abnormal ? "var(--mantine-color-red-0)" : "var(--mantine-color-body)",
										}}
									>
										<Group justify="space-between" align="center" wrap="nowrap">
											<Box style={{ minWidth: 0 }}>
												<Group gap={6} wrap="nowrap">
													<Text size="sm" fw={600}>{definition.label}</Text>
													<Badge size="xs" variant="light" color="gray">
														{CATEGORY_LABEL[definition.category]}
													</Badge>
												</Group>
												{result ? (
													<Group gap={4} mt={4} wrap="nowrap">
														<Text size="lg" fw={700}>{result.value}</Text>
														{definition.unit && <Text size="xs" c="dimmed">{definition.unit}</Text>}
														{result.status && (
															<Badge size="xs" color={abnormal ? "red" : "teal"} variant="light">
																{STATUS_LABEL[result.status] ?? result.status}
															</Badge>
														)}
													</Group>
												) : (
													<Text size="xs" c="dimmed" mt={4}>尚未检查</Text>
												)}
											</Box>
											<Button
												size="compact-sm"
												variant={result ? "subtle" : "light"}
												leftSection={pending ? <IconLoader2 size={14} /> : result ? <IconRefresh size={14} /> : <IconStethoscope size={14} />}
												disabled={pendingOp !== null}
												onClick={() => interact(opId)}
												aria-label={`${result ? "复查" : "检查"}${definition.label}`}
											>
												{pending ? "检查中" : result ? "复查" : "检查"}
											</Button>
										</Group>
										{error && (
											<Group gap={5} mt={8} c="red.7" wrap="nowrap">
												<IconAlertCircle size={14} />
												<Text size="xs">{error}</Text>
											</Group>
										)}
									</Box>
								);
							})}
						</Stack>
					</Box>

					{abnormalResults.length > 0 && (
						<Box p="sm" style={{ borderRadius: "var(--mantine-radius-md)", background: "var(--mantine-color-red-0)" }}>
							<Group gap={6} mb={6} wrap="nowrap">
								<IconAlertCircle size={16} color="var(--mantine-color-red-7)" />
								<Text size="sm" fw={600} c="red.8">异常发现</Text>
							</Group>
							<Stack gap={6}>
								{abnormalResults.map(([opId, result]) => {
									const definition = EXAMS[opId];
									if (!definition) return null;
									return (
										<Box key={opId}>
											<Group gap={5} wrap="nowrap">
												<IconCheck size={13} />
												<Text size="xs" fw={500}>{definition.label}</Text>
												<Text size="xs" fw={700}>{result.value}</Text>
												{definition.unit && <Text size="xs">{definition.unit}</Text>}
												<Badge size="xs" color="red" variant="light">
													{STATUS_LABEL[result.status ?? ""] ?? result.status}
												</Badge>
											</Group>
											{isGuided && result.interpretation && (
												<Text size="xs" c="dimmed" mt={3}>{result.interpretation}</Text>
											)}
										</Box>
									);
								})}
							</Stack>
						</Box>
					)}
			</Stack>
			</ScrollArea>
		</Box>
	);
}
