/**
 * 场景编辑器的面板：两个页签（表单 / JSON 原始）双向同步，保存一律**追加新修订**。
 *
 * 四条不变量：
 * - **永不原地修改**：没有"改已发布的修订"这条路；保存走 `POST .../revisions`，
 *   服务端按内容哈希决定是追加新修订还是幂等复用（内容没变就不产生假修订）。
 * - **一份文本、一份树**：表单改的是 `doc`，「JSON 原始」页签改的是文本；文本解析成功才写回 `doc`，
 *   解析失败**只保留文本 + 显示可读错误**，表单内容不动（不会把作者打的半截 JSON 变成空表单）。
 * - **校验只有一套**：保存前调 `POST .../validate`（与安装/加载同一套），
 *   失败时每条问题都带字段路径，界面把问题归位到节 + 顶部摘要，不重算判据。
 * - **历史形状只读**：修订的形状不是当前形状（`compatible=false` / `legacy=true`）时不给编辑——
 *   只**原样**显示它的 JSON，并明确说明这是切换前的形状；要基于它继续写必须走**显式转换**
 *   （`POST .../convert`），转换结果作为一份**未保存的草稿**载入，`notes`/`problems` 一并展示
 *   （不静默丢认不出的字段，也不假装历史修订已符合当今 schema）。
 *
 * 一个出口：**保存并试跑** —— 先追加修订，再用**这次刚保存的修订**开一局 `trial` 会话，
 * 然后跳到学生侧控制台（`/scenario?session=<id>`；与学生自己开始一局走同一条路由）。
 */

import {
	Alert,
	Badge,
	Button,
	Code,
	Group,
	Loader,
	Paper,
	Select,
	Stack,
	Tabs,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import Editor from "@monaco-editor/react";
import {
	IconAlertTriangle,
	IconDeviceFloppy,
	IconInfoCircle,
	IconPlayerPlay,
	IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import {
	convertAdminScenarioPack,
	createScenarioSession,
	getAdminScenarioPackSource,
	type ScenarioAdminPack,
	type ScenarioPackDoc,
	type ScenarioPackProblem,
	type ScenarioPackValidation,
	saveAdminScenarioPackRevision,
	validateAdminScenarioPack,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorDetail } from "@/utils/error";
import PackForm, { PACK_SECTIONS, sectionForPath } from "./editor/PackForm";
import { describeJsonError, diffPaths, fromJsonText, isPackDocShaped, toJsonText } from "./editor/packDoc";

/** 原始文本改动后的解析防抖（打字时不必每个字符都重解析）。 */
const PARSE_DEBOUNCE_MS = 250;

/** 顶部摘要最多列几条改动字段（其余折成"+N"）。 */
const MAX_LISTED_CHANGES = 12;

/** 保存的两个出口：只追加修订，或追加后立刻用它开一局试跑。 */
type SaveMode = "save" | "trial";

/** 显式转换的返回形状：契约由后端 schema 拥有（`api/scenario.ts` 尚未导出别名）。 */
type PackConversion = components["schemas"]["ScenarioAdminPackConvert"];

function changesSummary(changes: string[]): string {
	if (changes.length <= MAX_LISTED_CHANGES) return changes.join("、");
	return `${changes.slice(0, MAX_LISTED_CHANGES).join("、")} 等 ${changes.length} 处`;
}

/** 问题按节归位的结果：`null` 键 = 认不出属于哪一节（只在顶部摘要里列）。 */
function groupProblems(problems: ScenarioPackProblem[]): {
	groups: { section: string; label: string }[];
	rest: ScenarioPackProblem[];
} {
	const groups: { section: string; label: string }[] = [];
	const rest: ScenarioPackProblem[] = [];
	for (const problem of problems) {
		const section = sectionForPath(problem.path);
		if (section === null) {
			rest.push(problem);
			continue;
		}
		if (!groups.some((item) => item.section === section)) {
			groups.push({ section, label: PACK_SECTIONS.find((item) => item.id === section)?.label ?? section });
		}
	}
	return { groups, rest };
}

export default function AdminCaseEditorPanel({ pack }: { pack: ScenarioAdminPack }) {
	const queryClient = useQueryClient();
	const { confirm } = useConfirm();
	const navigate = useNavigate();
	const [revisionId, setRevisionId] = useState<number | null>(null);
	const [tab, setTab] = useState<string | null>("form");
	const [doc, setDoc] = useState<ScenarioPackDoc | null>(null);
	const [baseline, setBaseline] = useState<ScenarioPackDoc | null>(null);
	const [rawText, setRawText] = useState("");
	const [rawError, setRawError] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [problems, setProblems] = useState<ScenarioPackProblem[]>([]);
	/** 刚才那次保存会把内容装成哪个修订号（服务端算的，界面不猜）。 */
	const [planned, setPlanned] = useState<ScenarioPackValidation | null>(null);
	/** 显式转换的产物：一份**未保存的草稿** + 转换说明（被转换的那份修订保持只读不变）。 */
	const [conversion, setConversion] = useState<PackConversion | null>(null);
	const parseTimer = useRef<number | null>(null);

	const sourceQuery = useQuery({
		queryKey: queryKeys.scenario.admin.source(pack.key, revisionId),
		queryFn: () => getAdminScenarioPackSource(pack.key, revisionId ?? undefined),
		retry: false,
	});
	const source = sourceQuery.data;
	const revisions = source?.revisions ?? [];
	/** 载入的这份修订不是当前形状：只读，要编辑必须先显式转换。 */
	const legacyShape = source !== undefined && (source.compatible === false || source.legacy);
	/** 已经有转换草稿在手 → 可以编辑（哪怕当前载入的仍是那份旧修订）。 */
	const readOnly = legacyShape && conversion === null;

	// 载入（或换修订）即重建基线：`revision_id` 变了才重置——
	// 同一修订的后台刷新不会把作者正在改的内容冲掉。
	useEffect(() => {
		if (!source) return;
		const content = isPackDocShaped(source.content) ? source.content : null;
		setDoc(content);
		setBaseline(content);
		setRawText(content === null ? "" : toJsonText(content));
		setRawError(null);
		setProblems(source.problems ?? []);
		setPlanned(null);
		setNote("");
		setConversion(null);
	}, [source]);

	// 组件卸载时清掉待解析的定时器（防抖不做清理会在卸载后再 setState）。
	useEffect(
		() => () => {
			if (parseTimer.current !== null) clearTimeout(parseTimer.current);
		},
		[],
	);

	const changes = useMemo(
		() => (doc === null || baseline === null ? [] : diffPaths(baseline, doc)),
		[doc, baseline],
	);
	const dirty = changes.length > 0;
	/** 有可存的东西：改过字段，或手里是一份刚转换出来的草稿。 */
	const draftReady = dirty || conversion !== null;
	const grouped = groupProblems(problems);
	/** 这次要存的是什么改动（确认框与校验提示共用一句，避免两处说法不一致）。 */
	const changedText =
		changes.length > 0
			? changesSummary(changes)
			: conversion === null
				? "无"
				: `转换自 v${conversion.from_schema_version} 的整份草稿（逐字段差异见「JSON 原始」页签）`;

	/** 表单改一处：树与原始文本同时更新（表单页签下本来就看不到文本，不存在光标争夺）。 */
	const applyFormChange = (next: ScenarioPackDoc) => {
		setDoc(next);
		setRawText(toJsonText(next));
		setRawError(null);
		setProblems([]);
		setPlanned(null);
	};

	/** 原始文本改一处：防抖后解析；成功才写回树，失败只留文本 + 错误。 */
	const applyRawChange = (text: string) => {
		setRawText(text);
		if (parseTimer.current !== null) clearTimeout(parseTimer.current);
		parseTimer.current = setTimeout(() => {
			try {
				setDoc(fromJsonText(text));
				setRawError(null);
				setProblems([]);
				setPlanned(null);
			} catch (error) {
				// 保留文本与树：作者正在打的这半截不算数，等打完再解析
				setRawError(describeJsonError(error));
			}
		}, PARSE_DEBOUNCE_MS);
	};

	/** 试跑：用**刚保存的那个修订**开会话（`trial=true`），再跳到学生侧控制台。 */
	const startTrial = async (savedRevisionId: number) => {
		try {
			const session = await createScenarioSession({
				pack_key: pack.key,
				revision_id: savedRevisionId,
				trial: true,
			});
			navigate(`/scenario?session=${session.session_id}`);
		} catch (error) {
			toast.error(getApiErrorDetail(error, "试跑会话没有开起来"), {
				description: "修订已经保存了；可以稍后在学生侧「情境」里自己试。",
			});
		}
	};

	const validateMutation = useMutation({
		mutationFn: (vars: { content: ScenarioPackDoc; mode: SaveMode }) =>
			validateAdminScenarioPack(pack.key, vars.content),
		onSuccess: (result, vars) => {
			const found = result.problems ?? [];
			setProblems(found);
			setPlanned(result);
			if (!result.ok) {
				toast.error(`包未通过校验：${found.length} 处问题，已在字段旁标出`);
				return;
			}
			if (!result.will_append && vars.mode === "save") {
				toast.success("内容与当前最新修订一致，不需要保存");
				return;
			}
			void confirmThenSave(result, vars.mode);
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "校验失败")),
	});

	const confirmThenSave = async (result: ScenarioPackValidation, mode: SaveMode) => {
		const target = result.next_revision_no === null ? "新修订" : `修订 #${result.next_revision_no}`;
		const trialing = mode === "trial";
		const ok = await confirm({
			title: trialing
				? result.will_append
					? `保存为${target}并试跑？`
					: "用最新修订试跑？"
				: `保存为${target}？`,
			message: trialing
				? result.will_append
					? `将追加${target}（当前内容不会被原地修改，历史修订照旧），然后立刻用这个修订开一局试跑；试跑会话标记为 trial，默认不进统计。改动：${changedText}。`
					: `内容与当前最新修订一致，不会追加新修订；将直接用最新修订开一局试跑（标记为 trial，默认不进统计）。改动：${changedText}。`
				: `将追加${target}（当前内容不会被原地修改，历史修订照旧）。改动字段：${changedText}。`,
			confirmLabel: trialing ? "保存并开始试跑" : "保存并追加修订",
			danger: false,
		});
		if (ok && doc !== null) saveMutation.mutate({ content: doc, mode });
	};

	const saveMutation = useMutation({
		mutationFn: ({ content, mode }: { content: ScenarioPackDoc; mode: SaveMode }) =>
			saveAdminScenarioPackRevision(
				pack.key,
				content,
				// 试跑快照没有写说明时给一个诚实的默认值：修订历史里能认出这是试跑留下的
				mode === "trial" && note.trim() === "" ? "试跑快照" : note,
			),
		onSuccess: (result, vars) => {
			const pending = result.assets_pending ?? [];
			toast.success(
				result.created
					? `已追加修订 #${result.revision_no}${pending.length > 0 ? `（${pending.length} 个资源还缺字节）` : ""}`
					: `内容未变：复用修订 #${result.revision_no}`,
			);
			setNote("");
			setConversion(null);
			void queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });
			// 让编辑器切到刚保存的修订（重新读基线，"已修改"随之归零）
			setRevisionId(result.revision_id);
			if (vars.mode === "trial") void startTrial(result.revision_id);
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "保存失败")),
	});

	const convertMutation = useMutation({
		mutationFn: (id: number) => convertAdminScenarioPack(pack.key, id),
		onSuccess: (result) => {
			if (!isPackDocShaped(result.content)) {
				toast.error("转换结果不是可编辑的 JSON 表，没有载入草稿");
				return;
			}
			const content = result.content;
			// 载入为**草稿**：基线也跟着换成转换结果，所以"已修改 0 处"但草稿本身可保存；
			// 被转换的那份修订一个字节都没动（保存才会追加新修订）。
			setDoc(content);
			setBaseline(content);
			setRawText(toJsonText(content));
			setRawError(null);
			setProblems(result.problems ?? []);
			setPlanned(null);
			setConversion(result);
			setTab("form");
			toast.success(`已转换：v${result.from_schema_version} → v${result.to_schema_version}`, {
				description: "这是一份未保存的草稿：原修订不变，确认无误后再保存。",
			});
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "转换失败")),
	});

	if (sourceQuery.isLoading) {
		return (
			<Stack align="center" py="xl">
				<Loader size="sm" />
			</Stack>
		);
	}
	if (sourceQuery.isError || !source) {
		return (
			<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
				载入病例内容失败：{getApiErrorDetail(sourceQuery.error, "请稍后重试")}
			</Alert>
		);
	}
	if (doc === null) {
		return (
			<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
				第 #{source.revision_no} 修订的内容不是一张 JSON 表，编辑器读不出可编辑的字段；请在「修订」里核对这份修订的来源。
			</Alert>
		);
	}

	return (
		<Stack gap="md">
			<Paper withBorder p="md">
				<Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
					<Group gap="xs" align="center" wrap="wrap">
						<Select
							size="xs"
							w={220}
							label="载入哪一修订"
							data={revisions.map((item) => ({
								value: String(item.id),
								label: `#${item.no}${item.note !== "" ? ` · ${item.note}` : ""}`,
							}))}
							value={String(source.revision_id)}
							onChange={(value) => value && setRevisionId(Number(value))}
							allowDeselect={false}
						/>
						{revisionId !== null && revisionId !== revisions[0]?.id && !legacyShape && (
							<Badge variant="light" color="orange">
								在读历史修订：保存仍会追加新修订
							</Badge>
						)}
						{legacyShape && (
							<Badge variant="light" color="grape">
								形状 v{source.schema_version} · 只读历史修订
							</Badge>
						)}
						{dirty && (
							<Badge variant="light" color="blue">
								已修改 {changes.length} 处
							</Badge>
						)}
						{conversion !== null && (
							<Badge variant="light" color="grape">
								未保存的转换草稿
							</Badge>
						)}
					</Group>
					{readOnly ? (
						<Group gap="xs" align="flex-end">
							<Tooltip label="转换只生成一份未保存的草稿：这个修订不会被改动">
								<Button
									leftSection={<IconRefresh size={15} />}
									loading={convertMutation.isPending}
									onClick={() => convertMutation.mutate(source.revision_id)}
								>
									转换到 v{source.current_schema_version} 草稿
								</Button>
							</Tooltip>
						</Group>
					) : (
						<Group gap="xs" align="flex-end">
							<TextInput
								size="xs"
								w={240}
								label="这次改了什么（写进修订说明）"
								placeholder="如：修标题文案"
								value={note}
								onChange={(event) => setNote(event.currentTarget.value)}
							/>
							<Tooltip label={draftReady ? "先校验再保存" : "还没有任何改动"} disabled={draftReady}>
								<Button
									leftSection={<IconDeviceFloppy size={15} />}
									disabled={!draftReady || rawError !== null}
									loading={validateMutation.isPending || saveMutation.isPending}
									onClick={() => validateMutation.mutate({ content: doc, mode: "save" })}
								>
									保存（追加新修订）
								</Button>
							</Tooltip>
							{/* 试跑**不必先有改动**：内容没变就复用当前修订开局（确认框里会这么说）。
							    只有草稿解析失败时才禁用——否则"想试跑当前修订"就得先改一个字，那是假的限制。 */}
							<Tooltip label="先保存，再用刚存下的修订开一局试跑（trial，默认不进统计）；内容没变就直接用当前修订开局">
								<Button
									variant="default"
									leftSection={<IconPlayerPlay size={15} />}
									disabled={rawError !== null}
									loading={saveMutation.isPending}
									onClick={() => validateMutation.mutate({ content: doc, mode: "trial" })}
								>
									保存并试跑
								</Button>
							</Tooltip>
						</Group>
					)}
				</Group>
				<Text size="xs" c="dimmed" mt={6}>
					{readOnly
						? "这是切换前的形状：平台不就地改写、也不静默裁剪它；要继续编辑就用上面的显式转换。"
						: "保存**不会**改动任何已有修订：内容变了就追加一个新修订号，内容没变就复用当前修订。"}
				</Text>
			</Paper>

			{rawError !== null && (
				<Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
					JSON 解析失败（表单内容保持上一次能解析的版本，不会被清空）：{rawError}
				</Alert>
			)}

			{conversion !== null && (
				<Alert color="grape" variant="light" icon={<IconInfoCircle size={16} />} title={`已载入转换草稿：v${conversion.from_schema_version} → v${conversion.to_schema_version}`}>
					<Stack gap={4}>
						<Text size="xs">
							草稿来自第 #{source.revision_no} 修订的显式转换：原修订保持只读不变，**保存才会追加新修订**。
						</Text>
						{(conversion.notes ?? []).map((line, index) => (
							<Text size="xs" key={`${index}:${line}`}>
								· {line}
							</Text>
						))}
						{problems.length > 0 && (
							<Text size="xs">
								· 转换结果仍有 {problems.length} 处问题：已在下方「校验未通过」逐条列出（可跳节）。
							</Text>
						)}
					</Stack>
				</Alert>
			)}

			{legacyShape && readOnly && (
				<Alert color="grape" variant="light" icon={<IconAlertTriangle size={16} />} title="这份修订是历史形状（只读）">
					<Stack gap={4}>
						<Text size="sm">
							它的形状是 v{source.schema_version}，当前平台形状是 v{source.current_schema_version}。
							下面显示的是它**原样的 JSON**：平台不会把它硬塞进新形状，也不会悄悄丢掉认不出的字段。
						</Text>
						<Text size="sm">
							「转换到 v{source.current_schema_version} 草稿」会把它转成当前形状载入为一份未保存的草稿，
							并把转换说明（哪些字段被改写/删除、原值是什么）一并列出来；确认后再保存成新修订。
						</Text>
					</Stack>
				</Alert>
			)}

			{readOnly ? (
				<Stack gap="xs">
					<Text size="xs" c="dimmed">
						原始内容（只读）
					</Text>
					<Paper withBorder style={{ height: "calc(100vh - 380px)", minHeight: 420, overflow: "hidden" }}>
						<Editor
							height="100%"
							defaultLanguage="json"
							value={rawText}
							theme="vs-dark"
							options={{
								readOnly: true,
								domReadOnly: true,
								minimap: { enabled: false },
								lineNumbers: "on",
								scrollBeyondLastLine: false,
								fontSize: 13,
								tabSize: 2,
								automaticLayout: true,
							}}
						/>
					</Paper>
					{problems.length > 0 && (
						<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="按当前形状的规则，这份内容有这些问题">
							<Stack gap={2}>
								{problems.map((problem) => (
									<Text size="xs" key={`${problem.path}:${problem.message}`}>
										<Code>{problem.path}</Code> {problem.message}
									</Text>
								))}
							</Stack>
						</Alert>
					)}
				</Stack>
			) : (
				<>
					{problems.length > 0 && (
						<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="校验未通过">
							<Stack gap={4}>
								{grouped.groups.map((group) => (
									<Group key={group.section} gap="xs">
										<Button
											variant="subtle"
											size="compact-xs"
											onClick={() => {
												setTab("form");
												document.getElementById(`pack-section-${group.section}`)?.scrollIntoView({ block: "start" });
											}}
										>
											跳到「{group.label}」
										</Button>
										<Text size="xs">
											{problems.filter((problem) => sectionForPath(problem.path) === group.section).length} 处
										</Text>
									</Group>
								))}
								{grouped.rest.map((problem) => (
									<Text size="xs" key={`${problem.path}:${problem.message}`}>
										<Code>{problem.path}</Code> {problem.message}
									</Text>
								))}
							</Stack>
						</Alert>
					)}

					{planned?.ok && (
						<Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
							校验通过：内容哈希 {planned.content_sha}；保存将追加修订 #
							{planned.next_revision_no}。改动：{changedText}。
						</Alert>
					)}

					<Tabs value={tab} onChange={setTab}>
						<Tabs.List mb="md" className="sc-admin-tabs">
							<Tabs.Tab value="form">表单</Tabs.Tab>
							<Tabs.Tab value="json">JSON 原始</Tabs.Tab>
						</Tabs.List>

						{tab === "form" && <PackForm doc={doc} onChange={applyFormChange} problems={problems} />}
						{tab === "json" && (
							<Stack gap="xs">
								<Text size="xs" c="dimmed">
									这就是这份修订的原始内容（与团队上传统一份 JSON）。改动会与「表单」页签同步：
									表单改动会按统一缩进重排这段文本（注释不保留——JSON 本来也不允许注释）。
								</Text>
								<Paper withBorder style={{ height: "calc(100vh - 340px)", minHeight: 420, overflow: "hidden" }}>
									<Editor
										height="100%"
										defaultLanguage="json"
										value={rawText}
										onChange={(value) => applyRawChange(value ?? "")}
										theme="vs-dark"
										options={{
											minimap: { enabled: false },
											lineNumbers: "on",
											scrollBeyondLastLine: false,
											fontSize: 13,
											tabSize: 2,
											formatOnPaste: true,
											automaticLayout: true,
										}}
									/>
								</Paper>
							</Stack>
						)}
					</Tabs>
				</>
			)}
		</Stack>
	);
}
