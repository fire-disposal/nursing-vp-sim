/**
 * 场景编辑器的面板：两个页签（表单 / JSON 原始）双向同步，保存一律**追加新修订**。
 *
 * 三条不变量：
 * - **永不原地修改**：没有"改已发布的修订"这条路；保存走 `POST .../revisions`，
 *   服务端按内容哈希决定是追加新修订还是幂等复用（内容没变就不产生假修订）。
 * - **一份文本、一份树**：表单改的是 `doc`，「JSON 原始」页签改的是文本；文本解析成功才写回 `doc`，
 *   解析失败**只保留文本 + 显示可读错误**，表单内容不动（不会把作者打的半截 JSON 变成空表单）。
 * - **校验只有一套**：保存前调 `POST .../validate`（与安装/加载同一套），
 *   失败时每条问题都带字段路径，界面把问题归位到节 + 顶部摘要，不重算判据。
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
import { IconAlertTriangle, IconDeviceFloppy, IconInfoCircle } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
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
import { describeJsonError, diffPaths, fromJsonText, toJsonText } from "./editor/packDoc";

/** 原始文本改动后的解析防抖（打字时不必每个字符都重解析）。 */
const PARSE_DEBOUNCE_MS = 250;

/** 顶部摘要最多列几条改动字段（其余折成"+N"）。 */
const MAX_LISTED_CHANGES = 12;

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
	const parseTimer = useRef<number | null>(null);

	const sourceQuery = useQuery({
		queryKey: queryKeys.scenario.admin.source(pack.key, revisionId),
		queryFn: () => getAdminScenarioPackSource(pack.key, revisionId ?? undefined),
		retry: false,
	});
	const source = sourceQuery.data;

	// 载入（或换修订）即重建基线：`revision_id` 变了才重置——
	// 同一修订的后台刷新不会把作者正在改的内容冲掉。
	useEffect(() => {
		if (!source) return;
		setDoc(source.content);
		setBaseline(source.content);
		setRawText(toJsonText(source.content));
		setRawError(null);
		setProblems(source.problems);
		setPlanned(null);
		setNote("");
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
	const grouped = groupProblems(problems);

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

	const validateMutation = useMutation({
		mutationFn: (content: ScenarioPackDoc) => validateAdminScenarioPack(pack.key, content),
		onSuccess: (result) => {
			setProblems(result.problems);
			setPlanned(result);
			if (!result.ok) {
				toast.error(`包未通过校验：${result.problems.length} 处问题，已在字段旁标出`);
				return;
			}
			if (!result.will_append) {
				toast.success("内容与当前最新修订一致，不需要保存");
				return;
			}
			void confirmSave(result);
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "校验失败")),
	});

	const confirmSave = async (result: ScenarioPackValidation) => {
		const target = result.next_revision_no === null ? "新修订" : `修订 #${result.next_revision_no}`;
		const ok = await confirm({
			title: `保存为${target}？`,
			message: `将追加${target}（当前内容不会被原地修改，历史修订照旧）。改动字段：${changesSummary(changes)}。`,
			confirmLabel: "保存并追加修订",
			danger: false,
		});
		if (ok && doc !== null) saveMutation.mutate(doc);
	};

	const saveMutation = useMutation({
		mutationFn: (content: ScenarioPackDoc) => saveAdminScenarioPackRevision(pack.key, content, note),
		onSuccess: (result) => {
			toast.success(
				result.created
					? `已追加修订 #${result.revision_no}${result.assets_pending.length > 0 ? `（${result.assets_pending.length} 个资源还缺字节）` : ""}`
					: `内容未变：复用修订 #${result.revision_no}`,
			);
			setNote("");
			void queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });
			// 让编辑器切到刚保存的修订（重新读基线，"已修改"随之归零）
			setRevisionId(result.revision_id);
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "保存失败")),
	});

	const issueCountOf = (section: string) =>
		problems.filter((problem) => sectionForPath(problem.path) === section).length;

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

	return (
		<Stack gap="md">
			<Paper withBorder p="md">
				<Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
					<Group gap="xs" align="center" wrap="wrap">
						<Select
							size="xs"
							w={220}
							label="载入哪一修订"
							data={source.revisions.map((item) => ({
								value: String(item.id),
								label: `#${item.no}${item.note !== "" ? ` · ${item.note}` : ""}`,
							}))}
							value={String(source.revision_id)}
							onChange={(value) => value && setRevisionId(Number(value))}
							allowDeselect={false}
						/>
						{revisionId !== null && revisionId !== source.revisions[0]?.id && (
							<Badge variant="light" color="orange">
								在读历史修订：保存仍会追加新修订
							</Badge>
						)}
						{dirty && (
							<Badge variant="light" color="blue">
								已修改 {changes.length} 处
							</Badge>
						)}
					</Group>
					<Group gap="xs" align="flex-end">
						<TextInput
							size="xs"
							w={240}
							label="这次改了什么（写进修订说明）"
							placeholder="如：修标题文案"
							value={note}
							onChange={(event) => setNote(event.currentTarget.value)}
						/>
						<Tooltip label={dirty ? "先校验再保存" : "还没有任何改动"} disabled={dirty}>
							<Button
								leftSection={<IconDeviceFloppy size={15} />}
								disabled={!dirty || rawError !== null}
								loading={validateMutation.isPending || saveMutation.isPending}
								onClick={() => doc !== null && validateMutation.mutate(doc)}
							>
								保存（追加新修订）
							</Button>
						</Tooltip>
					</Group>
				</Group>
				<Text size="xs" c="dimmed" mt={6}>
					保存**不会**改动任何已有修订：内容变了就追加一个新修订号，内容没变就复用当前修订。
				</Text>
			</Paper>

			{rawError !== null && (
				<Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
					JSON 解析失败（表单内容保持上一次能解析的版本，不会被清空）：{rawError}
				</Alert>
			)}

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
								<Text size="xs">{issueCountOf(group.section)} 处</Text>
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
					{planned.next_revision_no}。改动字段：{changesSummary(changes)}。
				</Alert>
			)}

			<Tabs value={tab} onChange={setTab}>
				<Tabs.List mb="md" className="sc-admin-tabs">
					<Tabs.Tab value="form">表单</Tabs.Tab>
					<Tabs.Tab value="json">JSON 原始</Tabs.Tab>
				</Tabs.List>

				{tab === "form" && doc !== null && (
					<PackForm doc={doc} onChange={applyFormChange} problems={problems} />
				)}
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
		</Stack>
	);
}
