// Save（lucide）在 tabler 无同名图标，语义上取 IconDeviceFloppy（软盘保存）。
import { IconAlertCircle, IconDeviceFloppy, IconFileText } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Group, Loader, Stack, Text, Textarea } from "@mantine/core";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";
import type { TrainingToolProps } from "@/engine/TrainingTool";

interface SheetData {
	subjective?: string;
	objective?: string;
	assessment?: string;
	plan?: string;
	evaluation?: string;
}

interface TemplateData {
	hints?: Record<string, string>;
	fields?: Record<string, string>;
}

const FIELD_KEYS = ["subjective", "objective", "assessment", "plan", "evaluation"] as const;

const FALLBACK_LABELS: Record<string, string> = {
	subjective: "主观资料 (S)",
	objective: "客观资料 (O)",
	assessment: "评估 (A)",
	plan: "计划 (P)",
	evaluation: "评价 (E)",
};

const FALLBACK_PLACEHOLDERS: Record<string, string> = {
	subjective: "记录患者主诉、症状感受、现病史和既往史要点...",
	objective: "记录生命体征、体格检查结果、实验室数据等客观信息...",
	assessment: "基于收集的信息提出护理诊断，评估风险等级...",
	plan: "制定具体的护理措施、预期目标和健康教育内容...",
	evaluation: "评价措施效果，记录病情变化和后续计划...",
};

const LOAD_TIMEOUT_MS = 8000;

export default function NursingRecordTool({ recordId, bus }: TrainingToolProps) {
	const rid = Number(recordId);
	const [sheet, setSheet] = useState<SheetData>({});
	const [template, setTemplate] = useState<TemplateData>({});
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const dirtyRef = useRef(false);
	const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

	const requestLoad = useCallback(() => {
		setLoading(true);
		setLoadError(null);
		bus.emit("tool:invoke", { tool: "nursing_record", action: "load", params: {}, recordId: rid });
		if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
		loadTimeoutRef.current = setTimeout(() => {
			setLoading(false);
			setLoadError("加载超时：实时连接可能已中断，请检查网络后重试");
		}, LOAD_TIMEOUT_MS);
	}, [bus, rid]);

	useEffect(() => {
		return subscribeWSConnection((connected) => {
			if (connected && (loadError || loading)) {
				requestLoad();
			}
		});
	}, [loadError, loading, requestLoad]);

	useEffect(() => {
		requestLoad();
		return () => {
			if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
		};
	}, [requestLoad]);

	useEffect(() => {
		const onResult = (payload: {
			tool: string;
			action: string;
			ok: boolean;
			data: Record<string, unknown>;
			error?: string;
		}) => {
			if (payload.tool !== "nursing_record") return;
			if (payload.action === "load") {
				if (loadTimeoutRef.current) {
					clearTimeout(loadTimeoutRef.current);
					loadTimeoutRef.current = null;
				}
				if (payload.ok) {
					const sd = (payload.data.sheet_data as SheetData) || {};
					setSheet((prev) => {
						if (dirtyRef.current) return prev;
						if (Object.keys(prev).length > 0) return prev;
						return sd;
					});
					setTemplate((payload.data.template as TemplateData) || {});
					setLoading(false);
				} else {
					setLoading(false);
					setLoadError(payload.error || "加载护理记录失败");
				}
			}
			if (payload.action === "save") {
				if (payload.ok) {
					setSaveStatus("saved");
					setLastSavedAt(
						new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
					);
				} else {
					setSaveStatus("error");
				}
			}
		};
		bus.on("tool:result", onResult);
		return () => { bus.off("tool:result", onResult); };
	}, [bus]);

	const doSave = useCallback(
		(sd: SheetData) => {
			setSaveStatus("saving");
			bus.emit("tool:invoke", {
				tool: "nursing_record",
				action: "save",
				params: { sheet_data: sd, status: "draft" },
				recordId: rid,
			});
		},
		[bus, rid],
	);

	const update = (key: string, value: string) => {
		dirtyRef.current = true;
		setSheet((prev) => ({ ...prev, [key]: value }));
	};

	useEffect(() => {
		if (!dirtyRef.current) return;
		if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
		autoSaveTimerRef.current = setTimeout(() => {
			doSave(sheet);
		}, 3000);
		return () => {
			if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
		};
	}, [sheet, doSave]);

	useEffect(() => {
		if (!bus) return;
		const handler = () => {
			if (dirtyRef.current) {
				if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
				doSave(sheet);
			}
		};
		return bus.on("training:beforeEnd", handler);
	}, [bus, sheet, doSave]);


	if (loading) {
		return (
			<Group h={128} justify="center" align="center" c="dimmed" gap="xs">
				<Loader size="sm" />
				<Text size="sm">加载评估记录…</Text>
			</Group>
		);
	}

	if (loadError) {
		return (
			<Alert variant="light" color="red" icon={<IconAlertCircle size={16} />} title="加载失败">
				<Text size="sm" c="red">
					{loadError}
				</Text>
				<Button variant="outline" size="sm" mt="sm" onClick={requestLoad}>
					重试
				</Button>
			</Alert>
		);
	}

	const hints = template.hints || {};

	return (
		<Box
			component="form"
			p="sm"
			onSubmit={(e) => {
				e.preventDefault();
				doSave(sheet);
			}}
		>
			<Stack gap="md">
				{FIELD_KEYS.map((key) => {
					const label = template.fields?.[key] || FALLBACK_LABELS[key] || key;
					const placeholder = hints[key] || FALLBACK_PLACEHOLDERS[key] || "";
					return (
						<Textarea
							key={key}
							label={label}
							value={sheet[key] || ""}
							onChange={(e) => update(key, e.currentTarget.value)}
							placeholder={placeholder}
							autosize
							minRows={2}
							maxRows={10}
						/>
					);
				})}

				<Group justify="space-between" wrap="nowrap" pt="xs">
					<Group gap={6} wrap="nowrap">
						<IconFileText size={14} style={{ color: "var(--mantine-color-dimmed)" }} />
						<Text size="sm" c="dimmed">
							{saveStatus === "saving"
								? "保存中…"
								: saveStatus === "saved"
									? `已自动保存 ${lastSavedAt || ""}`
									: saveStatus === "error"
										? "保存失败"
										: "护理评估记录"}
						</Text>
					</Group>
					<Button type="submit" size="sm" leftSection={<IconDeviceFloppy size={14} />}>
						保存
					</Button>
				</Group>
			</Stack>
		</Box>
	);
}
