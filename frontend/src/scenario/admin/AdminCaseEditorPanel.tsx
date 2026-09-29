/**
 * 病例编辑器的面板：两个页签（表单 / JSON 原始）双向同步，保存就是保存。
 *
 * 三条不变量：
 * - **只编辑当前内容**：读走 `GET .../content`，存走 `POST .../content`。没有"改历史版本"这条路，
 *   也没有历史版本可列——病例就是「当前内容 + 整数 version」。内容变了 version +1，
 *   一样的内容重存不涨版本（后端返回 `changed=false` 时界面照实说，不假装存了新版本）。
 * - **一份文本、一份树**：表单改的是 `doc`，「JSON 原始」页签改的是文本；文本解析成功才写回 `doc`，
 *   解析失败**只保留文本 + 显示可读错误**，表单内容不动（不会把作者打的半截 JSON 变成空表单）。
 * - **校验只有一套**：保存前调 `POST .../validate`（与安装/加载同一套），
 *   失败时每条问题都带字段路径，界面把问题归位到节 + 顶部摘要，不重算判据。
 *
 * 一个出口：**保存并试跑** —— 先保存，再用这份病例开一局 `trial` 会话，
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
	Stack,
	Tabs,
	Text,
	Tooltip,
} from "@mantine/core";
import Editor from "@monaco-editor/react";
import {
	IconAlertTriangle,
	IconDeviceFloppy,
	IconInfoCircle,
	IconPlayerPlay,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import {
	createScenarioSession,
	getAdminScenarioPackContent,
	type ScenarioAdminPack,
	type ScenarioPackDoc,
	type ScenarioPackProblem,
	type ScenarioPackValidation,
	saveAdminScenarioPackContent,
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

/** 保存的两个出口：直接保存，或保存后立刻用它开一局试跑。 */
type SaveMode = "save" | "trial";

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
	const [tab, setTab] = useState<string | null>("form");
	const [doc, setDoc] = useState<ScenarioPackDoc | null>(null);
	const [baseline, setBaseline] = useState<ScenarioPackDoc | null>(null);
	const [rawText, setRawText] = useState("");
	const [rawError, setRawError] = useState<string | null>(null);
	const [problems, setProblems] = useState<ScenarioPackProblem[]>([]);
	/** 服务端记的内容版本：保存成功后以后端返回的为准，界面不自己 +1。 */
	const [version, setVersion] = useState<number | null>(null);
	/** 刚才那次校验的结果：服务端算的"这次保存会不会涨版本"，界面不猜。 */
	const [planned, setPlanned] = useState<ScenarioPackValidation | null>(null);
	const parseTimer = useRef<number | null>(null);
	/** 已经载入过的那一份（`key:version`）：同一个版本的后台刷新不冲掉作者正在改的内容。 */
	const loadedFor = useRef<string | null>(null);

	const contentQuery = useQuery({
		queryKey: queryKeys.scenario.admin.content(pack.key),
		queryFn: () => getAdminScenarioPackContent(pack.key),
		retry: false,
	});
	const source = contentQuery.data;

	// 载入即重建基线。这一个请求就是"当前内容"，没有换版本这回事：
	// 只有服务端的内容版本真的变了（别处存过），才重新载入并重建基线。
	useEffect(() => {
		if (!source) return;
		const stamp = `${source.key}:${source.version}`;
		if (loadedFor.current === stamp) return;
		loadedFor.current = stamp;
		const content = isPackDocShaped(source.content) ? source.content : null;
		setVersion(source.version);
		setDoc(content);
		setBaseline(content);
		setRawText(content === null ? "" : toJsonText(content));
		setRawError(null);
		setProblems(source.problems ?? []);
		setPlanned(null);
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
	/** 这次要存的是什么改动（确认框与校验提示共用一句，避免两处说法不一致）。 */
	const changedText = changes.length > 0 ? changesSummary(changes) : "无";

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

	/** 试跑：用这份病例开会话（`trial=true`），再跳到学生侧控制台。 */
	const startTrial = async () => {
		try {
			const session = await createScenarioSession({ pack_key: pack.key, trial: true });
			navigate(`/scenario?session=${session.session_id}`);
		} catch (error) {
			toast.error(getApiErrorDetail(error, "试跑会话没有开起来"), {
				description: "内容已经保存了；可以稍后在学生侧「情境」里自己试。",
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
				toast.error(`没通过校验：${found.length} 处问题，已在字段旁标出`);
				return;
			}
			if (!result.will_change && vars.mode === "save") {
				toast.success("内容与当前版本一致，不需要再存一次");
				return;
			}
			void confirmThenSave(result, vars.mode);
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "校验失败")),
	});

	const confirmThenSave = async (result: ScenarioPackValidation, mode: SaveMode) => {
		const trialing = mode === "trial";
		const ok = await confirm({
			title: trialing ? (result.will_change ? "保存后试跑？" : "直接试跑？") : "保存？",
			message: trialing
				? result.will_change
					? `内容会覆盖当前内容，版本 +1（现在是 #${result.version}），再用它开一局试跑，不会计入统计。改动：${changedText}。`
					: `内容没有变化，版本不变（#${result.version}）；直接用它开一局试跑，不会计入统计。改动：${changedText}。`
				: result.will_change
					? `内容会覆盖当前内容，版本 +1（现在是 #${result.version}）。改动：${changedText}。`
					: `内容没有变化，版本不变（#${result.version}）。改动：${changedText}。`,
			confirmLabel: trialing ? "保存并试跑" : "保存",
			danger: false,
		});
		if (ok && doc !== null) saveMutation.mutate({ content: doc, mode });
	};

	const saveMutation = useMutation({
		mutationFn: ({ content }: { content: ScenarioPackDoc; mode: SaveMode }) =>
			saveAdminScenarioPackContent(pack.key, content),
		onSuccess: (result, vars) => {
			const saved = isPackDocShaped(result.content) ? result.content : null;
			setVersion(result.version);
			if (saved !== null) {
				setDoc(saved);
				setBaseline(saved);
				setRawText(toJsonText(saved));
			} else {
				setBaseline(doc);
			}
			setProblems(result.problems ?? []);
			setPlanned(null);
			toast.success(
				result.changed
					? `已保存为版本 #${result.version}`
					: `内容没有变化：仍是版本 #${result.version}`,
			);
			void queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });
			if (vars.mode === "trial") void startTrial();
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "保存失败")),
	});

	if (contentQuery.isLoading) {
		return (
			<Stack align="center" py="xl">
				<Loader size="sm" />
			</Stack>
		);
	}
	if (contentQuery.isError || !source) {
		return (
			<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
				载入病例内容失败：{getApiErrorDetail(contentQuery.error, "请稍后重试")}
			</Alert>
		);
	}
	if (doc === null) {
		return (
			<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
				这份病例的内容不是一张可编辑的 JSON 表（顶层必须是一个对象），编辑器读不出字段；
				请在「JSON 原始」里核对它的来源。
			</Alert>
		);
	}

	return (
		<Stack gap="md">
			<Paper withBorder p="md">
				<Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
					<Group gap="xs" align="center" wrap="wrap">
						<Text size="sm" fw={600}>
							编辑病例
						</Text>
						<Badge variant="light" color="gray">
							版本 #{version ?? source.version}
						</Badge>
						{dirty && (
							<Badge variant="light" color="blue">
								已修改 {changes.length} 处
							</Badge>
						)}
					</Group>
					<Group gap="xs" align="flex-end">
						<Tooltip label={dirty ? "先校验再保存" : "还没有任何改动"} disabled={dirty}>
							<Button
								leftSection={<IconDeviceFloppy size={15} />}
								disabled={!dirty || rawError !== null}
								loading={validateMutation.isPending || saveMutation.isPending}
								onClick={() => validateMutation.mutate({ content: doc, mode: "save" })}
							>
								保存
							</Button>
						</Tooltip>
						{/* 试跑**不必先有改动**：内容没变就直接用当前版本开局（确认框里会这么说）。
						    只有草稿解析失败时才禁用——否则"想试跑当前版本"就得先改一个字，那是假的限制。 */}
						<Tooltip label="先保存，再用这份病例开一局试跑（不会计入统计）；内容没变就直接用当前内容开局">
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
				</Group>
				<Text size="xs" c="dimmed" mt={6}>
					保存是「覆盖当前内容」：内容变了版本 +1，一样的内容重存不涨版本。
					已经在跑的会话仍用它们开始时的内容。
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
					校验通过，可以保存。改动：{changedText}。
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
							这就是这份病例的原始内容（与团队上传统一份 JSON）。改动会与「表单」页签同步：
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
