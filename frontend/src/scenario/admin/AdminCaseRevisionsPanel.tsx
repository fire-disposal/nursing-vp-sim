import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Code,
	Group,
	List,
	Paper,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { IconAlertTriangle, IconRefresh, IconX } from "@tabler/icons-react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import {
	convertAdminScenarioPack,
	getAdminScenarioPackSource,
	patchAdminScenarioPack,
	type ScenarioAdminPack,
	type ScenarioPackState,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorDetail } from "@/utils/error";

/** 显式转换的返回形状：契约由后端 schema 拥有（`api/scenario.ts` 尚未导出别名）。 */
type PackConversion = components["schemas"]["ScenarioAdminPackConvert"];

/** 一次转换的现场：转的是哪一份修订、服务端回了什么。 */
type ConversionView = {
	revisionId: number;
	revisionNo: number;
	result: PackConversion;
};

/**
 * 修订 —— 这份病例的**历史与定稿状态**。
 *
 * 三件事，各有唯一入口：
 * - 修订历史：平台每次写入都追加一条（上传包 JSON、传/撤图片字节），`note` 就是那一次的
 *   **变更记录**（如 `asset:a_room by 20` / `drop asset:a_verify`）——这里逐条如实呈现。
 *   内容级逐字段比对需要读**历史修订的内容**，本面板不假装有（转换结果里的 `notes` 是
 *   服务端给出的、本次转换造成的改动说明，不等于两份修订之间的差异）。
 * - 形状与转换：「形状」是**每一份修订各自**的属性（内容里的 `pack_schema_version`），
 *   修订列表本身不带它，所以逐份读一次 `/source`。旧形状的修订是**只读**的：平台不在读取时
 *   静默裁剪它们，也不就地改写；要基于某一份继续编辑，就显式转换出一份**新草稿**
 *   （原修订一个字节都不动，草稿要保存才会成为新修订）。草稿的载入在「编辑」块里，
 *   「编辑」有它自己的修订选择；这里只报告转换的**后果**（notes / problems），不替它存草稿。
 * - 发布 / 退回：`state` 是**落库的标记**，不是权限开关（学生侧不受它过滤），
 *   所以误点一次就改了对外口径——必须二次确认（与既有的口径逐字一致）。
 */
export default function AdminCaseRevisionsPanel({ pack }: { pack: ScenarioAdminPack }) {
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const stateMutation = useMutation({
		mutationFn: ({ key, state }: { key: string; state: ScenarioPackState }) =>
			patchAdminScenarioPack(key, { state }),
		onSuccess: (data) => {
			toast.success(`${data.title}：状态改为 ${data.state}`);
			void queryClient.invalidateQueries({
				queryKey: queryKeys.scenario.admin.all,
			});
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "更新情境包失败")),
	});

	const changeState = async (next: ScenarioPackState) => {
		if (next === pack.state) return;
		const ok = await confirm({
			title: `把「${pack.title}」标记为${next === "reviewed" ? "已审" : "实验版"}？`,
			message:
				next === "reviewed"
					? "「已审」表示这份病例已经过审阅——学生看到的状态会随之变化。确定就改。"
					: "「实验版」表示内容仍在打磨：允许犯错、可直接分发。确定就改。",
			confirmLabel: "改状态",
			danger: next === "reviewed",
		});
		if (ok) stateMutation.mutate({ key: pack.key, state: next });
	};

	const reviewed = pack.state === "reviewed";
	const revisions = pack.revisions ?? [];
	/** 当前修订（最新那一份）。它的形状查询与「编辑」块共用同一个 query key。 */
	const currentRevisionId = pack.revision_id ?? null;

	/**
	 * 逐份读形状：`revision_id` 省略 = 最新那一份，所以最新修订走 `null` 键
	 * （与「编辑」共用缓存，不会有额外往返），其余修订用各自 id 的键。
	 * 读的是那一份的**原始内容**——形状就写在内容里，没有别的接口能只报版本号。
	 */
	const shapeQueries = useQueries({
		queries: revisions.map((revision) => ({
			queryKey: queryKeys.scenario.admin.source(
				pack.key,
				revision.id === currentRevisionId ? null : revision.id,
			),
			queryFn: () =>
				revision.id === currentRevisionId
					? getAdminScenarioPackSource(pack.key)
					: getAdminScenarioPackSource(pack.key, revision.id),
			retry: false,
		})),
	});

	const rows = revisions.map((revision, index) => {
		const query = shapeQueries[index];
		const shape = query?.data;
		const legacy = shape !== undefined && (shape.compatible === false || shape.legacy);
		return {
			revision,
			shape,
			legacy,
			shapeLoading: query?.isLoading ?? false,
			shapeFailed: query?.isError ?? false,
		};
	});
	const legacyRows = rows.filter((row) => row.legacy);
	const failedShapeRows = rows.filter((row) => row.shapeFailed);

	const [conversion, setConversion] = useState<ConversionView | null>(null);

	const convertMutation = useMutation({
		mutationFn: (revisionId: number) => convertAdminScenarioPack(pack.key, revisionId),
		onSuccess: (result, revisionId) => {
			const revision = revisions.find((item) => item.id === revisionId);
			setConversion({ revisionId, revisionNo: revision?.no ?? 0, result });
			toast.success(
				`已转换 修订 #${revision?.no ?? "?"}：v${result.from_schema_version} → v${result.to_schema_version}`,
				{ description: "原修订不变；转换结果是一份未保存的草稿。" },
			);
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "转换失败")),
	});

	/**
	 * 转换结果必须**确实**以被转换的那份修订为输入。两处可核对的硬证据：
	 * 结果里的 `key` 应当是本病例的 key，`from_schema_version` 应当是那份修订的形状版本。
	 * 对不上就明说这次转换没有以该修订为输入——绝不把一份空转换当成"转换好了的草稿"。
	 */
	const conversionMismatch: string | null = (() => {
		if (conversion === null) return null;
		const content = conversion.result.content;
		if (content === undefined) return "服务端返回的转换结果里没有内容。";
		const key = content.key;
		if (key !== pack.key) {
			return `转换结果里的 key 是 ${
				typeof key === "string" ? `「${key}」` : "（缺失）"
			}，不是本病例的「${pack.key}」：服务端没有以这份修订的内容为输入，所以这不是一份可用的草稿（原始修订不受影响）。`;
		}
		const expected = rows.find((row) => row.revision.id === conversion.revisionId)?.shape
			?.schema_version;
		if (expected !== undefined && expected !== conversion.result.from_schema_version) {
			return `转换结果声称来源是 v${conversion.result.from_schema_version}，但这份修订的形状是 v${expected}：服务端没有以这份修订的内容为输入（原始修订不受影响）。`;
		}
		return null;
	})();

	return (
		<Stack gap="md">
			<Paper withBorder p="md">
				<Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
					<div>
						<Group gap="xs" mb={4}>
							<Text fw={600}>当前修订</Text>
							<Badge variant="light" color={reviewed ? "green" : "gray"}>
								{reviewed ? "已审" : "实验版"}
							</Badge>
						</Group>
						<Text size="sm">
							#{pack.revision_no ?? "—"}
							<Text span size="xs" c="dimmed">
								{" "}
								（id {pack.revision_id ?? "—"}）· 共 {revisions.length} 个修订 ·{" "}
								{pack.sessions} 次会话
							</Text>
						</Text>
						<Text size="xs" c="dimmed" mt={4}>
							{reviewed
								? "「已审」= 这份病例已过审阅，可以直接分发给学生。"
								: "「实验版」= 内容仍在打磨：允许犯错、可直接分发，门禁只报风险。"}
						</Text>
					</div>
					<Group gap="xs">
						{reviewed ? (
							<Button
								variant="default"
								loading={stateMutation.isPending}
								onClick={() => void changeState("experimental")}
							>
								退回实验版
							</Button>
						) : (
							<Button
								loading={stateMutation.isPending}
								onClick={() => void changeState("reviewed")}
							>
								发布（标记为已审）
							</Button>
						)}
					</Group>
				</Group>
			</Paper>

			<Paper withBorder p="md">
				<Text fw={600} mb={4}>
					修订历史
				</Text>
				<Text size="xs" c="dimmed" mb="sm">
					每次写入追加一条（上传包 JSON、传/撤资源字节），说明就是那一次的变更记录。
					已经在跑的会话仍用它们开始时的修订；已写入的内容不会被后来的写入改写。
					旧形状的修订是**只读**的：要基于它继续编辑，就用它那一行的「转换到草稿」——
					转换只产出新草稿，原修订不变（草稿的载入与保存都在「编辑」块里）。
				</Text>
				{legacyRows.length > 0 && (
					<Text size="xs" c="grape" mb="sm">
						这份病例有 {legacyRows.length} 个修订是机制切换前的形状（
						{legacyRows
							.map((row) => `#${row.revision.no} v${row.shape?.schema_version}`)
							.join("、")}
						）：平台读取时按迁移路径兼容它们，但**不就地改写**这些修订本身——它们保持只读。
					</Text>
				)}
				{failedShapeRows.length > 0 && (
					<Alert
						color="yellow"
						variant="light"
						icon={<IconAlertTriangle size={16} />}
						mb="sm"
					>
						<Group gap="xs" align="center" wrap="wrap">
							<Text size="xs">
								有 {failedShapeRows.length} 个修订的形状读不出来：这些行不标形状、也不给转换入口
								（不知道形状就不猜）。
							</Text>
							<Button
								size="compact-xs"
								variant="light"
								leftSection={<IconRefresh size={13} />}
								onClick={() => {
									for (const query of shapeQueries) {
										if (query.isError) void query.refetch();
									}
								}}
							>
								重试
							</Button>
						</Group>
					</Alert>
				)}
				{revisions.length === 0 ? (
					<Text size="sm" c="dimmed">
						这份病例还没有任何修订。
					</Text>
				) : (
					<Table.ScrollContainer minWidth={620}>
						<Table verticalSpacing="xs">
							<Table.Thead>
								<Table.Tr>
									<Table.Th>修订</Table.Th>
									<Table.Th>变更说明</Table.Th>
									<Table.Th>形状</Table.Th>
									<Table.Th>id</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{rows.map(({ revision, shape, legacy, shapeLoading, shapeFailed }) => (
									<Table.Tr key={revision.id}>
										<Table.Td>
											<Group gap={6}>
												<Text size="sm">#{revision.no}</Text>
												{revision.id === pack.revision_id && (
													<Badge size="xs" variant="light">
														当前
													</Badge>
												)}
											</Group>
										</Table.Td>
										<Table.Td>
											<Text size="xs">{revision.note || "—"}</Text>
										</Table.Td>
										<Table.Td>
											{shapeFailed ? (
												<Text size="xs" c="dimmed">
													读不出形状
												</Text>
											) : shapeLoading || shape === undefined ? (
												<Text size="xs" c="dimmed">
													读取中…
												</Text>
											) : (
												<Stack gap={4} align="flex-start">
													<Badge
														size="xs"
														variant="light"
														color={legacy ? "grape" : "green"}
														title={
															legacy
																? "这份修订是切换前的形状：只读，编辑需先显式转换"
																: "这份修订是当前形状"
														}
													>
														形状 v{shape.schema_version}
														{legacy ? " · 只读" : ""}
													</Badge>
													{legacy && (
														<Button
															size="compact-xs"
															variant="light"
															color="grape"
															leftSection={<IconRefresh size={13} />}
															loading={
																convertMutation.isPending &&
																convertMutation.variables ===
																	revision.id
															}
															onClick={() =>
																convertMutation.mutate(revision.id)
															}
														>
															转换到 v
															{shape?.current_schema_version ?? "?"}{" "}
															草稿
														</Button>
													)}
												</Stack>
											)}
										</Table.Td>
										<Table.Td>
											<Code>{revision.id}</Code>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</Table.ScrollContainer>
				)}
			</Paper>

			{conversion !== null && (
				<Paper withBorder p="md">
					<Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
						<Text fw={600}>
							转换结果：修订 #{conversion.revisionNo}（id {conversion.revisionId}）v
							{conversion.result.from_schema_version} → v
							{conversion.result.to_schema_version}
						</Text>
						<ActionIcon
							variant="subtle"
							aria-label="收起转换结果"
							onClick={() => setConversion(null)}
						>
							<IconX size={16} />
						</ActionIcon>
					</Group>
					<Text size="xs" c="dimmed" mt={4}>
						原修订**一个字节都没改**：上面这份内容是一份**未保存的草稿**，没有成为新修订。
						要把它变成修订，就在「编辑」块里选这份修订、点转换（编辑器会把结果载入为草稿）、
						再保存——保存才会追加新修订。
					</Text>

					{conversionMismatch !== null && (
						<Alert
							color="red"
							variant="light"
							icon={<IconAlertTriangle size={16} />}
							mt="sm"
						>
							{conversionMismatch}
						</Alert>
					)}

					<Text size="sm" fw={500} mt="sm">
						转换说明 notes（{conversion.result.notes?.length ?? 0} 条）
					</Text>
					{(conversion.result.notes?.length ?? 0) === 0 ? (
						<Text size="xs" c="dimmed">
							服务端没有给出需要说明的改动。
						</Text>
					) : (
						<List size="xs">
							{(conversion.result.notes ?? []).map((note, index) => (
								<List.Item key={`${index}-${note}`}>{note}</List.Item>
							))}
						</List>
					)}

					<Text size="sm" fw={500} mt="sm">
						转换后仍存在的问题 problems（{conversion.result.problems?.length ?? 0} 条）
					</Text>
					{(conversion.result.problems?.length ?? 0) === 0 ? (
						<Text size="xs" c="dimmed">
							没有：服务端对转换结果跑了加载期校验，零问题。
						</Text>
					) : (
						<List size="xs">
							{(conversion.result.problems ?? []).map((problem, index) => (
								<List.Item key={`${index}-${problem.path}-${problem.message}`}>
									{problem.path === ""
										? problem.message
										: `${problem.path}：${problem.message}`}
								</List.Item>
							))}
						</List>
					)}
				</Paper>
			)}
		</Stack>
	);
}
