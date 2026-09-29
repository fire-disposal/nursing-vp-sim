/**
 * 病例编辑器的面板：四张页签（表单 / 散文 / 图片 / 原始），保存就是保存。
 *
 * 三条不变量：
 * - **只编辑当前内容**：读走 `GET .../content`，存走 `POST .../content`。没有"改历史版本"这条路，
 *   也没有历史版本可列——病例就是「当前内容 + 整数 version」。内容变了 version +1，
 *   一样的内容重存不涨版本（后端返回 `changed=false` 时界面照实说，不假装存了新版本）。
 * - **一份数据、一份编辑态**：表单、散文、图片声明改的都是同一个 `doc`；
 *   「原始」页签是**只读**原文（后端导出 zip 里的 TOML/MD），不参与回写——
 *   要改结构就去表单，要离线改就导出文件夹再导入。
 * - **校验只有一套**：保存前调 `POST .../validate`（与安装/加载同一套），
 *   失败时每条问题都带字段路径，界面把问题归位到**页签 + 节**，不重算判据。
 *
 * 一个出口：**保存并试跑** —— 先保存，再用这份病例开一局 `trial` 会话，
 * 然后跳到学生侧控制台（`/scenario?session=<id>`；与学生自己开始一局走同一条路由）。
 */

import { Alert, Badge, Button, Code, Group, Loader, Paper, Stack, Tabs, Text, Tooltip } from "@mantine/core";
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
import AssetsForm from "./editor/AssetsForm";
import PackForm from "./editor/PackForm";
import ProseForm from "./editor/ProseForm";
import RawSource from "./editor/RawSource";
import { isPackDocShaped, diffPaths } from "./editor/packDoc";
import { issuesOf, PACK_SECTIONS, type PackSectionTab, sectionForPath } from "./editor/sections";

/** 顶部摘要最多列几条改动字段（其余折成"+N"）。 */
const MAX_LISTED_CHANGES = 12;

/** 保存的两个出口：直接保存，或保存后立刻用它开一局试跑。 */
type SaveMode = "save" | "trial";

function changesSummary(changes: string[]): string {
	if (changes.length <= MAX_LISTED_CHANGES) return changes.join("、");
	return `${changes.slice(0, MAX_LISTED_CHANGES).join("、")} 等 ${changes.length} 处`;
}

/** 问题按节归位的结果：认不出属于哪一节的那些只在顶部摘要里列。 */
function groupProblems(problems: ScenarioPackProblem[]): {
	groups: { section: string; label: string; tab: PackSectionTab }[];
	rest: ScenarioPackProblem[];
} {
	const groups: { section: string; label: string; tab: PackSectionTab }[] = [];
	const rest: ScenarioPackProblem[] = [];
	for (const problem of problems) {
		const section = sectionForPath(problem.path);
		const hit = PACK_SECTIONS.find((item) => item.id === section);
		if (hit === undefined) {
			rest.push(problem);
			continue;
		}
		if (!groups.some((item) => item.section === hit.id)) {
			groups.push({ section: hit.id, label: hit.label, tab: hit.tab });
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
	const [problems, setProblems] = useState<ScenarioPackProblem[]>([]);
	/** 服务端记的内容版本：保存成功后以后端返回的为准，界面不自己 +1。 */
	const [version, setVersion] = useState<number | null>(null);
	/** 刚才那次校验的结果：服务端算的"这次保存会不会涨版本"，界面不猜。 */
	const [planned, setPlanned] = useState<ScenarioPackValidation | null>(null);
	/** 已经载入过的那一份（`key:version`）：同一个版本的后台刷新不冲掉作者正在改的内容。 */
	const loadedFor = useRef<string | null>(null);

	const contentQuery = useQuery({
		queryKey: queryKeys.scenario.admin.content(pack.key),
		queryFn: () => getAdminScenarioPackContent(pack.key),
		retry: false,
	});
	const source = contentQuery.data;

	// 载入即重建基线。这一个请求就是"当前内容"，没有换版本这回事：
	// 只有服务端的内容版本真的变了（别处存过、图片字节传过），才重新载入并重建基线。
	useEffect(() => {
		if (!source) return;
		const stamp = `${source.key}:${source.version}`;
		if (loadedFor.current === stamp) return;
		loadedFor.current = stamp;
		const content = isPackDocShaped(source.content) ? source.content : null;
		setVersion(source.version);
		setDoc(content);
		setBaseline(content);
		setProblems(source.problems ?? []);
		setPlanned(null);
	}, [source]);

	const changes = useMemo(
		() => (doc === null || baseline === null ? [] : diffPaths(baseline, doc)),
		[doc, baseline],
	);
	const dirty = changes.length > 0;
	const grouped = groupProblems(problems);
	/** 这次要存的是什么改动（确认框与校验提示共用一句，避免两处说法不一致）。 */
	const changedText = changes.length > 0 ? changesSummary(changes) : "无";

	/** 任何一处改动都走它：树变了、旧的问题与校验结果就作废（它们说的不是这一版）。 */
	const applyChange = (next: ScenarioPackDoc) => {
		setDoc(next);
		setProblems([]);
		setPlanned(null);
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
				这份病例的内容不是一张可编辑的表（顶层必须是一个对象），编辑器读不出字段；
				请用「导出」下载它的原始文件核对来源。
			</Alert>
		);
	}

	/** 跳到某一节：先切到它所在的页签，再滚到那一节。 */
	const jumpTo = (section: string, target: PackSectionTab) => {
		setTab(target);
		window.requestAnimationFrame(() => {
			document.getElementById(`pack-section-${section}`)?.scrollIntoView({ block: "start" });
		});
	};

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
								disabled={!dirty}
								loading={validateMutation.isPending || saveMutation.isPending}
								onClick={() => validateMutation.mutate({ content: doc, mode: "save" })}
							>
								保存
							</Button>
						</Tooltip>
						{/* 试跑**不必先有改动**：内容没变就直接用当前版本开局（确认框里会这么说）。 */}
						<Tooltip label="先保存，再用这份病例开一局试跑（不会计入统计）；内容没变就直接用当前内容开局">
							<Button
								variant="default"
								leftSection={<IconPlayerPlay size={15} />}
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

			{problems.length > 0 && (
				<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="校验未通过">
					<Stack gap={4}>
						{grouped.groups.map((group) => (
							<Group key={group.section} gap="xs">
								<Button
									variant="subtle"
									size="compact-xs"
									onClick={() => jumpTo(group.section, group.tab)}
								>
									跳到「{group.label}」
								</Button>
								<Text size="xs">{issuesOf(problems, group.section).length} 处</Text>
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
					<Tabs.Tab value="prose">散文</Tabs.Tab>
					<Tabs.Tab value="assets">图片</Tabs.Tab>
					<Tabs.Tab value="raw">原始</Tabs.Tab>
				</Tabs.List>

				{tab === "form" && <PackForm doc={doc} onChange={applyChange} problems={problems} />}
				{tab === "prose" && <ProseForm doc={doc} onChange={applyChange} problems={problems} />}
				{tab === "assets" && (
					<AssetsForm
						doc={doc}
						onChange={applyChange}
						problems={problems}
						pack={pack}
						dirty={dirty}
					/>
				)}
				{tab === "raw" && <RawSource packKey={pack.key} />}
			</Tabs>
		</Stack>
	);
}
