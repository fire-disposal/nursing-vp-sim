import {
	Alert,
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
import { IconInfoCircle } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	type ScenarioAdminPack,
	createBlankScenarioPack,
	deleteAdminScenarioPack,
	duplicateAdminScenarioPack,
	importAdminScenarioPack,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorDetail } from "@/utils/error";
import { downloadStandardCase, exportCaseFolder } from "./transfer";
import { usePackPublish } from "./usePackPublish";

/**
 * 病例列表 —— 管理侧「病例」区的**根**：一行一个病例，进入它的工作区。
 *
 * 这里**不是**五个平铺页签之一，而是唯一的病例入口：图片、散文、会话、统计
 * 全都在"某个病例的工作区"里，所以不再有"选了病例再切页签、选择就没了"这种事。
 *
 * 病例的模型只有三件事：**当前内容**、整数 `version`（内容变了才 +1）、**是否上架**。
 * 所以这一行也只报这三件事加两处计数（会话 / 图片）。
 *
 * 开一份新病例的三条路（都不需要作者写文件格式）：
 * - **标准模板**：下载一个最小可跑病例的文件夹压缩包（`key`/`title` 可预填）；
 * - **导入**：一个 zip，或直接选一个文件夹（后端按相对路径找 `case.toml`）；
 * - **新建空白**：平台给一份最小骨架，直接在编辑器里写。
 * 导入返回的 `problems` 是**提示**（忽略了哪些多余文件、缺哪张图），不是失败——照原话渲染出来。
 *
 * 系统侧闭环：复制 / 上架下架 / 删除 / 导出。删除的边界由后端定死——
 * **有会话就不能删**（会话自带内容快照，但病例是这些会话的归属）：界面上灰掉并说明原因，
 * 后端若仍返回 409（别人刚开了一局）也照原话转述，不翻译成"删除失败请重试"。
 */

/** `<input webkitdirectory>` 是浏览器属性、React 的类型里没有它，所以挂载时用 DOM 设上去。 */
function DirectoryPicker({
	value,
	onPick,
}: {
	value: File[];
	onPick: (files: File[]) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		input.current?.setAttribute("webkitdirectory", "");
		input.current?.setAttribute("directory", "");
	}, []);
	return (
		<Group gap="xs" align="center">
			<Button variant="default" onClick={() => input.current?.click()}>
				选择文件夹
			</Button>
			<Text size="xs" c="dimmed">
				{value.length === 0 ? "选一个病例文件夹（含 case.toml）" : `${value.length} 个文件`}
			</Text>
			<input
				ref={input}
				type="file"
				multiple
				hidden
				data-testid="case-directory-input"
				onChange={(event) => onPick([...(event.currentTarget.files ?? [])])}
			/>
		</Group>
	);
}

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
	/** 内容权限：没有它时连导入/下载入口都不显示（后端也会拒，前端不该更宽松）。 */
	canContent: boolean;
}) {
	const [zip, setZip] = useState<File | null>(null);
	const [folder, setFolder] = useState<File[]>([]);
	const [importNotes, setImportNotes] = useState<string[]>([]);
	const [templateKey, setTemplateKey] = useState("");
	const [templateTitle, setTemplateTitle] = useState("");
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

	const importMutation = useMutation({
		mutationFn: (files: File[]) => importAdminScenarioPack(files),
		onSuccess: (data) => {
			// `problems` 是宽容导入的**提示**（多余文件、缺图…），照原话列出来，不当失败
			setImportNotes(data.problems ?? []);
			setZip(null);
			setFolder([]);
			toast.success(
				data.changed
					? `${data.key}：已导入为版本 #${data.version}`
					: `${data.key}：内容与当前版本一致，没有新增版本`,
				{ description: data.title },
			);
			void invalidate();
		},
		onError: (e) => {
			setImportNotes([]);
			toast.error(getApiErrorDetail(e, "导入病例失败"));
		},
	});

	const templateMutation = useMutation({
		mutationFn: () => downloadStandardCase(templateKey, templateTitle),
		onSuccess: () =>
			toast.success("标准模板已下载", {
				description: "解压后就是一个病例文件夹（case.toml / case.md / img/），改完从「导入」传回来。",
			}),
		onError: (e) => toast.error(getApiErrorDetail(e, "下载标准模板失败")),
	});

	const exportMutation = useMutation({
		mutationFn: (key: string) => exportCaseFolder(key),
		onSuccess: () => toast.success("病例已导出", { description: "压缩包里是 case.toml / case.md / img/。" }),
		onError: (e) => toast.error(getApiErrorDetail(e, "导出病例失败")),
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

	const importFiles = zip !== null ? [zip] : folder;

	return (
		<Stack gap="md">
			{canContent && (
				<Paper withBorder p="md">
					<Text fw={600} mb={4}>
						添加病例
					</Text>
					<Text size="xs" c="dimmed" mb="sm">
						一份病例 = 一个文件夹（`case.toml` + `case.md` + `img/`）。下模板、改好、导入回来，
						整条路都不用在这里写格式；导入后剩下的都在工作区的编辑器里用表单改。
					</Text>
					<Stack gap="md">
						<Group align="flex-end" gap="sm" wrap="wrap">
							<TextInput
								label="标准模板的 key"
								description="可作为新病例的编号"
								placeholder="new-case"
								value={templateKey}
								onChange={(event) => setTemplateKey(event.currentTarget.value)}
								w={200}
							/>
							<TextInput
								label="标准模板的标题"
								placeholder="新病例"
								value={templateTitle}
								onChange={(event) => setTemplateTitle(event.currentTarget.value)}
								w={240}
							/>
							<Button
								variant="light"
								loading={templateMutation.isPending}
								onClick={() => templateMutation.mutate()}
							>
								下载标准模板
							</Button>
						</Group>

						<Group align="flex-end" gap="sm" wrap="wrap">
							<FileInput
								label="压缩包"
								placeholder="选择 .zip"
								description="一个病例一个 zip"
								accept="application/zip,.zip"
								value={zip}
								onChange={(file) => {
									setZip(file);
									if (file !== null) setFolder([]);
								}}
								w={220}
							/>
							<DirectoryPicker
								value={folder}
								onPick={(files) => {
									setFolder(files);
									if (files.length > 0) setZip(null);
								}}
							/>
							<Button
								loading={importMutation.isPending}
								disabled={importFiles.length === 0}
								onClick={() => importMutation.mutate(importFiles)}
							>
								导入
							</Button>
						</Group>

						{importNotes.length > 0 && (
							<Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />} title="导入提示">
								<Stack gap={2}>
									{importNotes.map((note) => (
										<Text size="xs" key={note}>
											{note}
										</Text>
									))}
								</Stack>
							</Alert>
						)}
					</Stack>
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
					还没有病例。{canContent ? "可以从标准模板开始，或导入一个病例文件夹。" : ""}
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
													<Badge color={missing > 0 ? "orange" : "green"} variant="light">
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
												<Button size="compact-sm" variant="light" onClick={() => onOpen(pack.key)}>
													进入工作区
												</Button>
												{canContent && (
													<>
														<Button
															size="compact-sm"
															variant={pack.published ? "default" : "filled"}
															onClick={() =>
																void flipPublished(pack.key, pack.title, !pack.published)
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
														<Tooltip label="下载病例文件夹（case.toml / case.md / img/），可离线改再导入">
															<Button
																size="compact-sm"
																variant="light"
																loading={
																	exportMutation.isPending &&
																	exportMutation.variables === pack.key
																}
																onClick={() => exportMutation.mutate(pack.key)}
															>
																导出
															</Button>
														</Tooltip>
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
