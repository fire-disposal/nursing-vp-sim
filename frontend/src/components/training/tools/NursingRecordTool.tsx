import { APP_TIME_ZONE } from "@/utils/date";
// Save（lucide）在 tabler 无同名图标，语义上取 IconDeviceFloppy（软盘保存）。
import {
	IconAlertCircle,
	IconDeviceFloppy,
	IconFileText,
	IconLock,
	IconPencil,
	IconSend,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Alert,
	Box,
	Button,
	Group,
	Loader,
	Modal,
	Stack,
	Text,
	Textarea,
} from "@mantine/core";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";
import { formatShortDateTime } from "@/utils/date";
import type { ActivityPanelProps } from "@/components/training/workspace/contract";
import {
	type NursingRecordSheet,
	useTrainingStore,
} from "@/stores/trainingStore";
type SheetData = NursingRecordSheet;

interface TemplateData {
	hints?: Record<string, string>;
	fields?: Record<string, string>;
}

interface ToolResultPayload {
	tool: string;
	action: string;
	ok: boolean;
	data: Record<string, unknown>;
	error?: string;
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

export default function NursingRecordTool({ activity, recordId, bus }: ActivityPanelProps) {
	/** 命令命名空间来自 manifest 的 activity 定义（渲染器不自己命名能力） */
	const command = activity.id;
	const rid = Number(recordId);
	const sheet = useTrainingStore((s) => s.nursingRecordDraft) ?? {};
	const dirty = useTrainingStore((s) => s.nursingRecordDirty);
	const submittedAt = useTrainingStore((s) => s.nursingRecordSubmittedAt);
	const hydrateSheet = useTrainingStore((s) => s.hydrateNursingRecord);
	const updateField = useTrainingStore((s) => s.updateNursingRecordField);
	const markSaved = useTrainingStore((s) => s.markNursingRecordSaved);
	const markSubmitted = useTrainingStore((s) => s.markNursingRecordSubmitted);
	const markReopened = useTrainingStore((s) => s.markNursingRecordReopened);
	const [template, setTemplate] = useState<TemplateData>({});
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const autoSaveTimerRef = useRef<number | undefined>(undefined);
	const loadTimeoutRef = useRef<number | undefined>(undefined);
	const latestSheetRef = useRef<SheetData>(sheet);
	const dirtyRef = useRef(dirty);
	const submittedRef = useRef<boolean>(!!submittedAt);
	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [reopening, setReopening] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [submitMissing, setSubmitMissing] = useState<string[]>([]);
	const [confirmOpen, setConfirmOpen] = useState(false);

	const readOnly = !!submittedAt;

	// 本地实时缺失提示：不必等提交往返就能看到还差哪几项
	const missingFields = useMemo(
		() => FIELD_KEYS.filter((key) => !String(sheet[key] ?? "").trim()),
		[sheet],
	);
	const fieldLabels = template.fields || FALLBACK_LABELS;
	const hasContent = missingFields.length < FIELD_KEYS.length;

	/**
	 * 拉取服务端真值。
	 *
	 * ``silent`` 用于「本地状态已过期」的自动回读（如保存撞上已提交冲突）：
	 * 不接管面板、不设超时——被拒的原因必须留在屏幕上，而不是被加载态吞掉。
	 */
	const requestLoad = useCallback(
		(options?: { silent?: boolean }) => {
			if (!options?.silent) {
				setLoading(true);
				setLoadError(null);
			}
			bus.emit("tool:invoke", {
				tool: command,
				action: "load",
				params: {},
				recordId: rid,
			});
			clearTimeout(loadTimeoutRef.current);
			if (options?.silent) return;
			loadTimeoutRef.current = window.setTimeout(() => {
				setLoading(false);
				setLoadError("加载超时：实时连接可能已中断，请检查网络后重试");
			}, LOAD_TIMEOUT_MS);
		},
		[bus, command, rid],
	);

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
			clearTimeout(loadTimeoutRef.current);
		};
	}, [requestLoad]);

	useEffect(() => {
		const onResult = (payload: ToolResultPayload) => {
			if (payload.tool !== command) return;
			const data = payload.data || {};
			const errorCode = typeof data.code === "string" ? data.code : "";

			if (payload.action === "load") {
				if (loadTimeoutRef.current) {
					clearTimeout(loadTimeoutRef.current);
					loadTimeoutRef.current = undefined;
				}
				if (payload.ok) {
					const sd = (data.sheet_data as SheetData) || {};
					hydrateSheet(sd, { submitted_at: (data.submitted_at as string | null) ?? null });
					setTemplate((data.template as TemplateData) || {});
					setActionError(null);
					setLoading(false);
				} else {
					setLoading(false);
					setLoadError(payload.error || "加载护理评估记录失败");
				}
				return;
			}

			if (payload.action === "save") {
				if (payload.ok) {
					const savedSheet = (data.sheet_data as SheetData | undefined) ?? {};
					markSaved(savedSheet);
					setSaveStatus("saved");
					setLastSavedAt(
						new Date().toLocaleTimeString("zh-CN", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit" }),
					);
					return;
				}
				setSaveStatus("error");
				setActionError(payload.error || "草稿保存失败");
				// 服务端说「已提交」→ 本地状态已过期，回读服务端真值（进入只读态）
				if (errorCode === "nursing_record_submitted") requestLoad({ silent: true });
				return;
			}

			if (payload.action === "submit") {
				setSubmitting(false);
				if (payload.ok) {
					const frozen = (data.sheet_data as SheetData | undefined) ?? latestSheetRef.current;
					markSubmitted(frozen, (data.submitted_at as string | null) ?? new Date().toISOString());
					setActionError(null);
					setSubmitMissing([]);
					setConfirmOpen(false);
					setSaveStatus("idle");
					return;
				}
				setActionError(payload.error || "提交失败，请重试");
				setSubmitMissing(
					Array.isArray(data.missing_fields) ? (data.missing_fields as string[]) : [],
				);
				// 已提交冲突 → 回读服务端冻结版本，避免本地状态与服务端分叉
				if (errorCode === "nursing_record_submitted") requestLoad({ silent: true });
				return;
			}

			if (payload.action === "reopen") {
				setReopening(false);
				if (payload.ok) {
					markReopened();
					setActionError(null);
					return;
				}
				setActionError(payload.error || "重新编辑失败，请重试");
			}
		};
		bus.on("tool:result", onResult);
		return () => { bus.off("tool:result", onResult); };
	}, [bus, command, hydrateSheet, markReopened, markSubmitted, markSaved, requestLoad]);

	const doSave = useCallback(
		(sd: SheetData) => {
			if (submittedRef.current) return; // 冻结版本：草稿保存不再发生
			setSaveStatus("saving");
			bus.emit("tool:invoke", {
				tool: command,
				action: "save",
				params: { sheet_data: sd },
				recordId: rid,
			});
		},
		[bus, command, rid],
	);

	const doSubmit = useCallback(() => {
		if (submittedRef.current) return;
		clearTimeout(autoSaveTimerRef.current); // 提交在同一请求里落盘草稿，无需再补一次自动保存
		setSubmitting(true);
		setActionError(null);
		bus.emit("tool:invoke", {
			tool: command,
			action: "submit",
			params: { sheet_data: latestSheetRef.current },
			recordId: rid,
		});
	}, [bus, command, rid]);

	const doReopen = useCallback(() => {
		setReopening(true);
		setActionError(null);
		bus.emit("tool:invoke", {
			tool: command,
			action: "reopen",
			params: {},
			recordId: rid,
		});
	}, [bus, command, rid]);

	const update = (key: string, value: string) => {
		setActionError(null);
		updateField(key, value);
	};

	useEffect(() => {
		latestSheetRef.current = sheet;
		dirtyRef.current = dirty;
		submittedRef.current = readOnly;
		// 已提交 → 内容冻结，不再自动保存
		if (!dirty || readOnly) return;
		clearTimeout(autoSaveTimerRef.current);
		autoSaveTimerRef.current = window.setTimeout(() => {
			doSave(sheet);
		}, 3000);
		return () => {
			clearTimeout(autoSaveTimerRef.current);
		};
	}, [sheet, dirty, readOnly, doSave]);

	useEffect(
		() => () => {
			if (submittedRef.current || !dirtyRef.current) return;
			bus.emit("tool:invoke", {
				tool: command,
				action: "save",
				params: { sheet_data: latestSheetRef.current },
				recordId: rid,
			});
		},
		[bus, command, rid],
	);

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
				<Button variant="outline" size="sm" mt="sm" onClick={() => requestLoad()}>
					重试
				</Button>
			</Alert>
		);
	}

	const hints = template.hints || {};
	const pendingMissing = submitMissing.length > 0 ? submitMissing : missingFields;

	return (
		<Box component="form" p="sm" onSubmit={(e) => { e.preventDefault(); if (!readOnly) doSave(sheet); }}>
			<Stack gap="md">
				{readOnly && (
					<Alert
						variant="light"
						color="green"
						icon={<IconLock size={16} />}
						title="护理评估已提交"
						p="xs"
					>
						<Text size="xs">
							内容已冻结并进入评分{formatShortDateTime(submittedAt) ? `（${formatShortDateTime(submittedAt)}）` : ""}。
							如需修改，请点击下方「重新编辑」。
						</Text>
					</Alert>
				)}

				{FIELD_KEYS.map((key) => {
					const label = fieldLabels[key] || FALLBACK_LABELS[key] || key;
					const placeholder = hints[key] || FALLBACK_PLACEHOLDERS[key] || "";
					const empty = !readOnly && !String(sheet[key] ?? "").trim();
					return (
						<Textarea
							key={key}
							label={
								<Group gap={6} wrap="nowrap">
									<Text size="sm" fw={500}>{label}</Text>
									{empty && (
										<Text size="xs" c="orange">
											未填写
										</Text>
									)}
								</Group>
							}
							value={sheet[key] || ""}
							onChange={(e) => update(key, e.currentTarget.value)}
							placeholder={placeholder}
							readOnly={readOnly}
							autosize
							minRows={2}
							maxRows={10}
							styles={readOnly ? { input: { color: "var(--mantine-color-dimmed)" } } : undefined}
						/>
					);
				})}

				{actionError && (
					<Alert variant="light" color="red" icon={<IconAlertCircle size={16} />} p="xs">
						<Text size="xs" c="red">{actionError}</Text>
						{pendingMissing.length > 0 && (
							<Text size="xs" c="dimmed" mt={4}>
								仍缺少：{pendingMissing.map((k) => fieldLabels[k] || k).join("、")}
							</Text>
						)}
					</Alert>
				)}

				<Stack gap={8}>
					<Group gap={6} wrap="nowrap">
						{readOnly ? (
							<IconLock size={14} style={{ color: "var(--mantine-color-green-7)" }} />
						) : (
							<IconFileText size={14} style={{ color: "var(--mantine-color-dimmed)" }} />
						)}
						<Text size="sm" c={readOnly ? "green" : "dimmed"}>
							{readOnly
								? `已提交 ${formatShortDateTime(submittedAt)}`
								: saveStatus === "saving"
									? "保存中…"
									: saveStatus === "saved"
										? `已自动保存 ${lastSavedAt || ""}`
										: saveStatus === "error"
											? "保存失败"
											: "护理评估记录（草稿）"}
						</Text>
					</Group>

					{!readOnly && missingFields.length > 0 && (
						<Text size="xs" c="dimmed">
							未填写：{missingFields.map((k) => fieldLabels[k] || k).join("、")}
						</Text>
					)}

					<Group gap="xs" wrap="wrap" grow>
						{readOnly ? (
							<Button
								variant="outline"
								size="sm"
								loading={reopening}
								onClick={doReopen}
								leftSection={<IconPencil size={14} />}
							>
								重新编辑
							</Button>
						) : (
							<>
								<Button
									variant="default"
									size="sm"
									type="submit"
									disabled={!dirty || submitting}
									leftSection={<IconDeviceFloppy size={14} />}
								>
									保存草稿
								</Button>
								<Button
									size="sm"
									color="green"
									loading={submitting}
									disabled={!hasContent}
									onClick={() => setConfirmOpen(true)}
									leftSection={<IconSend size={14} />}
								>
									提交评估
								</Button>
							</>
						)}
					</Group>

					{!readOnly && (
						<Text size="xs" c="dimmed">
							提交后内容将被冻结并作为评分依据；结束训练前必须已提交。
						</Text>
					)}
				</Stack>
			</Stack>

			<Modal
				opened={confirmOpen}
				onClose={() => setConfirmOpen(false)}
				title="确认提交护理评估？"
				size="md"
			>
				<Stack gap="sm">
					<Text size="sm">
						提交后内容即被冻结并进入评分，不能直接修改（如需修改需重新编辑）。
					</Text>
					{missingFields.length > 0 && (
						<Alert variant="light" color="orange" p="xs">
							<Text size="xs" c="orange">
								以下字段尚未填写，可能影响完整性与评分：
							</Text>
							<Text size="xs" c="dimmed" mt={4}>
								{missingFields.map((k) => fieldLabels[k] || k).join("、")}
							</Text>
						</Alert>
					)}
					<Group justify="flex-end" gap="xs" wrap="nowrap">
						<Button variant="default" size="sm" onClick={() => setConfirmOpen(false)}>
							取消
						</Button>
						<Button size="sm" color="green" loading={submitting} onClick={doSubmit}>
							确认提交
						</Button>
					</Group>
				</Stack>
			</Modal>
		</Box>
	);
}
