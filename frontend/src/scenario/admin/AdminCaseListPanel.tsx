import {
	Badge,
	Button,
	Code,
	FileInput,
	Group,
	Loader,
	Modal,
	Paper,
	Stack,
	Table,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	type ScenarioAdminPack,
	createBlankScenarioPack,
	deleteAdminScenarioPack,
	duplicateAdminScenarioPack,
	uploadAdminScenarioPack,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorDetail } from "@/utils/error";
import { usePackPublish } from "./usePackPublish";

/**
 * 病例列表 —— 管理侧「病例」区的**根**：一行一个病例，进入它的工作区。
 *
 * 这里**不是**五个平铺页签之一，而是唯一的病例入口：图片、会话、统计
 * 全都在"某个病例的工作区"里，所以不再有"选了病例再切页签、选择就没了"这种事。
 *
 * 病例的模型只有三件事：**当前内容**、整数 `version`（内容变了才 +1）、**是否上架**。
 * 所以这一行也只报这三件事加两处计数（会话 / 图片）。
 *
 * 系统侧闭环：新建空白 / 复制 / 上架下架 / 删除。删除的边界由后端定死——
 * **有会话就不能删**（会话自带内容快照，但病例是这些会话的归属）：界面上灰掉并说明原因，
 * 后端若仍返回 409（别人刚开了一局）也照原话转述，不翻译成"删除失败请重试"。
 */
export default function AdminCaseListPanel({
	packs,
	loading,
	onOpen,
	canContent,
}: {
	packs: ScenarioAdminPack[];
	loading: boolean;
	/** 进入某个病例的工作区（由页面切到工作区并写进地址栏）。 */
	onOpen: (packKey: string) => void;
	/** 内容权限：没有它时连上传入口都不显示（后端也会拒，前端不该更宽松）。 */
	canContent: boolean;
}) {
	const [file, setFile] = useState<File | null>(null);
	const [blankKey, setBlankKey] = useState("");
	const [blankTitle, setBlankTitle] = useState("");
	/** 正在复制的源病例（`null` = 复制对话框没开）。 */
	const [dupSource, setDupSource] = useState<ScenarioAdminPack | null>(null);
	const [dupKey, setDupKey] = useState("");
	const [dupTitle, setDupTitle] = useState("");
	const queryClient = useQueryClient();
	const { confirm } = useConfirm();
	const publish = usePackPublish();

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });

	const blankMutation = useMutation({
		mutationFn: () => createBlankScenarioPack({ key: blankKey.trim(), title: blankTitle.trim() }),
		onSuccess: (data) => {
			toast.success(`${data.key}：已建好一份最小可跑的病例骨架`, {
				description: "它还是「未上架」：改完点那一行的「上架」，学生才看得到。",
			});
			setBlankKey("");
			setBlankTitle("");
			void invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "新建空白病例失败")),
	});

	const duplicateMutation = useMutation({
		mutationFn: () =>
			duplicateAdminScenarioPack(dupSource?.key ?? "", {
				key: dupKey.trim(),
				title: dupTitle.trim(),
			}),
		onSuccess: (data) => {
			toast.success(`${data.key}：已复制成一个新病例`, {
				description: "它是「未上架」的：内容接的是源病例当前版本，改完再上架。",
			});
			setDupSource(null);
			setDupKey("");
			setDupTitle("");
			void invalidate();
		},
		// 复制失败如实转述：key 撞了、源病例没了都是后端说了算
		onError: (e) => toast.error(getApiErrorDetail(e, "复制病例失败")),
	});

	const deleteMutation = useMutation({
		mutationFn: (key: string) => deleteAdminScenarioPack(key),
		onSuccess: (data) => {
			toast.success(`${data.key}：已删除`, {
				description:
					data.deleted_assets > 0
						? `连同 ${data.deleted_assets} 张图片的字节一起删掉了。已有的会话记录不受影响。`
						: "已有的会话记录不受影响。",
			});
			void invalidate();
		},
		// 409 `pack_has_sessions` 的原话就是"已有 N 局记录，可下架但不可删除"：
		// `getApiErrorDetail` 会把后端那句中文原样带出来，这里不改成"请重试"
		onError: (e) => toast.error(getApiErrorDetail(e, "删除病例失败")),
	});

	/** 上架/下架都要二次确认：这一步决定学生看不看得到。 */
	const flipPublished = async (key: string, title: string, next: boolean) => {
		const ok = await confirm({
			title: next ? `把「${title}」上架？` : `把「${title}」下架？`,
			message: next
				? "上架后学生列表里能看到它、可以开新局。上架前会再校验一次内容。"
				: "下架后学生列表里不再出现它、也不能开新局；已有的会话与记录照常回看。",
			confirmLabel: next ? "上架" : "下架",
			danger: !next,
		});
		if (ok) publish.mutate({ key, publish: next });
	};

	const askDelete = async (pack: ScenarioAdminPack) => {
		const ok = await confirm({
			title: `删除「${pack.title}」？`,
			message: `删除后这个病例的当前内容与它的图片字节都一并删掉，不能撤销。已有的会话记录仍能回放（它们自带内容快照）。`,
			confirmLabel: "确认删除",
			danger: true,
		});
		if (ok) deleteMutation.mutate(pack.key);
	};

	const openDuplicate = (pack: ScenarioAdminPack) => {
		setDupSource(pack);
		setDupKey(`${pack.key}-copy`);
		setDupTitle(`${pack.title}（副本）`);
	};

	const uploadMutation = useMutation({
		mutationFn: uploadAdminScenarioPack,
		onSuccess: (data) => {
			const pending = data.assets_pending ?? [];
			toast.success(
				data.created
					? `${data.key}：已保存为版本 #${data.version}`
					: `${data.key}：内容与当前版本一致，没有新增版本`,
				{
					description:
						pending.length > 0
							? `还有 ${pending.length} 张图片没有上传，进这个病例的「图片」里传。`
							: undefined,
				},
			);
			setFile(null);
			void invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "上传病例失败")),
	});

	return (
		<Stack gap="md">
			{canContent && (
				<Paper withBorder p="md">
					<Text fw={600} mb={4}>
						上传病例（JSON）
					</Text>
					<Text size="xs" c="dimmed" mb="sm">
						上传就是保存：它成为这份病例的「当前内容」，内容变了版本 +1（一样的内容重传不涨版本）。
						已经在跑的会话仍用它们开始时的内容。图片的字节不在这里——传进病例工作区的「图片」。
					</Text>
					<Group align="flex-end" gap="sm" wrap="wrap">
						<FileInput
							label="病例 JSON"
							placeholder="选择 .json 文件"
							accept="application/json,.json"
							value={file}
							onChange={setFile}
							w={280}
						/>
						<Button
							onClick={() => file && uploadMutation.mutate({ file })}
							disabled={!file}
							loading={uploadMutation.isPending}
						>
							上传
						</Button>
					</Group>
				</Paper>
			)}

			{canContent && (
				<Paper withBorder p="md">
					<Text fw={600} mb={4}>
						新建空白病例
					</Text>
					<Text size="xs" c="dimmed" mb="sm">
						给一份最小可运行的骨架（一个人物 + 一个动作 + 一条线索），拿到就能进工作区改、就能试跑。
						新建的病例是未上架的：学生看不到，改完在下面那一行点「上架」。
					</Text>
					<Group align="flex-end" gap="sm" wrap="wrap">
						<TextInput
							label="病例 key"
							placeholder="如：night-shift-2"
							value={blankKey}
							onChange={(event) => setBlankKey(event.currentTarget.value)}
							w={220}
						/>
						<TextInput
							label="标题"
							placeholder="如：夜班第二例"
							value={blankTitle}
							onChange={(event) => setBlankTitle(event.currentTarget.value)}
							w={260}
						/>
						<Button
							loading={blankMutation.isPending}
							disabled={blankKey.trim() === "" || blankTitle.trim() === ""}
							onClick={() => blankMutation.mutate()}
						>
							新建
						</Button>
					</Group>
				</Paper>
			)}

			{loading ? (
				<Group justify="center" py="xl">
					<Loader size="sm" />
				</Group>
			) : packs.length === 0 ? (
				<Text size="sm" c="dimmed">
					还没有病例。{canContent ? "先上传一份病例 JSON。" : ""}
				</Text>
			) : (
				<Table.ScrollContainer minWidth={960}>
					<Table highlightOnHover verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>病例</Table.Th>
								<Table.Th>状态</Table.Th>
								<Table.Th>版本</Table.Th>
								<Table.Th>会话</Table.Th>
								<Table.Th>图片</Table.Th>
								<Table.Th>操作</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{packs.map((pack) => {
								// `assets` 在生成物里是可选的：缺就是"没声明"，
								// 不把 undefined 拿去 `.length`，也不在下游各处再兜一次。
								const assets = pack.assets ?? [];
								const uploaded = assets.filter((a) => a.uploaded).length;
								const missing = assets.length - uploaded;
								const blockedBySessions = pack.sessions > 0;
								return (
									<Table.Tr key={pack.key}>
										<Table.Td>
											<Text fw={600}>{pack.title}</Text>
											<Text size="xs" c="dimmed">
												{pack.key}
											</Text>
											{pack.one_line && (
												<Text size="xs" c="dimmed" maw={420}>
													{pack.one_line}
												</Text>
											)}
										</Table.Td>
										<Table.Td>
											<Group gap={6}>
												{pack.published ? (
													<Badge variant="light" color="green">
														已上架
													</Badge>
												) : (
													<Badge variant="light" color="orange">
														未上架
													</Badge>
												)}
											</Group>
										</Table.Td>
										<Table.Td>
											<Text size="sm">版本 #{pack.version}</Text>
										</Table.Td>
										<Table.Td>
											<Text size="sm">{pack.sessions}</Text>
										</Table.Td>
										<Table.Td>
											{assets.length === 0 ? (
												<Text size="xs" c="dimmed">
													未声明图片
												</Text>
											) : (
												<Group gap={6}>
													<Badge
														color={missing > 0 ? "orange" : "green"}
														variant="light"
													>
														{uploaded}/{assets.length} 已上传
													</Badge>
													{missing > 0 && (
														<Text size="xs" c="orange">
															还有 {missing} 张没传
														</Text>
													)}
												</Group>
											)}
											{missing > 0 && (
												<Text size="xs" c="dimmed" mt={4}>
													未上传：
													<Code>
														{assets
															.filter((a) => !a.uploaded)
															.map((a) => a.id)
															.join(", ")}
													</Code>
												</Text>
											)}
										</Table.Td>
										<Table.Td>
											<Group gap="xs" wrap="wrap">
												<Button
													size="compact-sm"
													variant="light"
													onClick={() => onOpen(pack.key)}
												>
													进入工作区
												</Button>
												{canContent && (
													<>
														<Button
															size="compact-sm"
															variant={pack.published ? "default" : "filled"}
															onClick={() =>
																void flipPublished(
																	pack.key,
																	pack.title,
																	!pack.published,
																)
															}
														>
															{pack.published ? "下架" : "上架"}
														</Button>
														<Button
															size="compact-sm"
															variant="light"
															onClick={() => openDuplicate(pack)}
														>
															复制
														</Button>
														<Tooltip
															label={
																blockedBySessions
																	? `已有 ${pack.sessions} 局记录，可下架但不可删除`
																	: "删除病例与它的图片字节"
															}
														>
															<Button
																size="compact-sm"
																variant="subtle"
																color="red"
																disabled={blockedBySessions}
																onClick={() => void askDelete(pack)}
															>
																删除
															</Button>
														</Tooltip>
													</>
												)}
											</Group>
											{canContent && blockedBySessions && (
												<Text size="xs" c="dimmed" mt={4}>
													已有 {pack.sessions} 局记录，可下架但不可删除
												</Text>
											)}
										</Table.Td>
									</Table.Tr>
								);
							})}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}

			<Modal
				opened={dupSource !== null}
				onClose={() => setDupSource(null)}
				title={dupSource ? `复制「${dupSource.title}」` : "复制病例"}
				size="md"
				centered
			>
				<Stack gap="sm">
					<Text size="xs" c="dimmed">
						新病例的第 1 个版本就是源病例「当前版本」的内容；它是未上架的，改完再上架。
					</Text>
					<TextInput
						label="新病例 key"
						placeholder="如：night-shift-2"
						value={dupKey}
						onChange={(event) => setDupKey(event.currentTarget.value)}
					/>
					<TextInput
						label="新病例标题"
						placeholder="如：夜班第二例"
						value={dupTitle}
						onChange={(event) => setDupTitle(event.currentTarget.value)}
					/>
					<Group justify="flex-end" gap="sm">
						<Button variant="default" onClick={() => setDupSource(null)}>
							取消
						</Button>
						<Button
							loading={duplicateMutation.isPending}
							disabled={dupKey.trim() === "" || dupTitle.trim() === ""}
							onClick={() => duplicateMutation.mutate()}
						>
							复制
						</Button>
					</Group>
				</Stack>
			</Modal>
		</Stack>
	);
}
