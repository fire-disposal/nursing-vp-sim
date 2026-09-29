import {
	Badge,
	Button,
	Code,
	FileInput,
	Group,
	Modal,
	Paper,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	deleteAdminScenarioAsset,
	replaceAdminScenarioAsset,
	type ScenarioAdminAsset,
	type ScenarioAdminPack,
	type ScenarioAssetReplaceInput,
	type ScenarioAssetUploadInput,
	scenarioAssetSrc,
	uploadAdminScenarioAsset,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import AuthImage from "@/components/ui/auth-image";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorDetail } from "@/utils/error";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

function formatBytes(size: number): string {
	if (!size) return "—";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** 病例里引用一张图写的就是这个（`images` 里就长这样，也收裸编号）。 */
function assetRef(id: string): string {
	return `{"asset_id": "${id}"}`;
}

interface ReplaceDraft {
	asset: ScenarioAdminAsset;
	file: File | null;
	title: string;
	alt: string;
}

/**
 * 图片：一个病例的图，上传 / 替换 / 删除三步都在这里做完。
 *
 * 病例内容只声明"有这张图、编号是什么、什么时候值得展示"；**字节必须在这里传**：
 * `uploaded=false` 就是"作者写了这张图、库里还没有它"，学生端取图会 404。
 * 上传走 `AuthImage` 同一套鉴权（Bearer → blob），所以预览能证明字节真的存进去了。
 *
 * 保存语义（都与后端一致，界面上也照实说）：
 * - 上传一个**新编号** → 声明写进当前内容，内容变了 version +1；
 * - 上传一个**已有编号** = 替换：同一编号只有一份字节，新图顶替旧图（走 `replace`，`asset_id` 不变）；
 * - 删除 → 声明从当前内容里去掉，字节也从库里删掉。
 *
 * 图片按**编号**存（不是按版本）：所以正在跑的会话里，同一个编号取到的也是当下的字节。
 * 病例由调用方（工作区头部）给定——这里**没有选择器**：同一个病例不会有两个"当前"。
 */
export default function AdminAssetsPanel({ pack }: { pack: ScenarioAdminPack }) {
	const [assetId, setAssetId] = useState("");
	const [title, setTitle] = useState("");
	const [alt, setAlt] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<ScenarioAdminAsset | null>(null);
	const [previewNonce, setPreviewNonce] = useState(0);
	const [draft, setDraft] = useState<ReplaceDraft | null>(null);
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();
	/** 声明清单（后端字段可选：没有就是空清单，不是"未知"）。 */
	const assets = pack.assets ?? [];

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });

	/** 图换了字节之后预览要重取：变化量一变，`AuthImage` 就重新拉一次。 */
	const bumpPreview = () => setPreviewNonce((n) => n + 1);

	const uploadMutation = useMutation({
		mutationFn: (payload: ScenarioAssetUploadInput) =>
			uploadAdminScenarioAsset(pack.key, payload),
		onSuccess: (data) => {
			toast.success(`${data.asset.id}：图片已保存`, {
				description:
					"这一张图的声明写进了病例的当前内容（内容变了版本就 +1）。正在进行的会话也按编号取这张图。",
			});
			setAssetId("");
			setTitle("");
			setAlt("");
			setFile(null);
			setPreview(data.asset);
			bumpPreview();
			invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "上传图片失败")),
	});

	/** 替换：`asset_id` 不变（内容里的引用不用改），只换字节与文案。 */
	const replaceMutation = useMutation({
		mutationFn: ({ assetId: id, payload }: { assetId: string; payload: ScenarioAssetReplaceInput }) =>
			replaceAdminScenarioAsset(pack.key, id, payload),
		onSuccess: (data) => {
			toast.success(`${data.asset.id}：已换成新图`, {
				description:
					"病例里这个编号就是新图，没有新旧两份；图按编号只存一份，正在进行中的会话取到的也是新图。",
			});
			setDraft(null);
			setPreview(data.asset);
			bumpPreview();
			invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "替换图片失败")),
	});

	/** 「补上传」：作者声明了编号、库里还没有字节——走新建那条路（编号此前没有字节）。 */
	const saveDraftMutation = useMutation({
		mutationFn: (payload: ScenarioAssetUploadInput) =>
			uploadAdminScenarioAsset(pack.key, payload),
		onSuccess: (data) => {
			toast.success(`${data.asset.id}：图片已保存`, {
				description: "病例里这个编号现在有图了。",
			});
			setDraft(null);
			setPreview(data.asset);
			bumpPreview();
			invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "保存图片失败")),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => deleteAdminScenarioAsset(pack.key, id),
		onSuccess: (data, id) => {
			toast.success(`${id}：已删除`, {
				description: `声明已从病例的当前内容里去掉（现在是版本 #${data.version}），这张图的字节也从库里删掉了。`,
			});
			setPreview((current) => (current?.id === id ? null : current));
			invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "删除图片失败")),
	});

	const removeAsset = async (asset: ScenarioAdminAsset) => {
		const ok = await confirm({
			title: `删除 ${asset.id}？`,
			message: `删除后，这个病例里不再有「${asset.title || asset.id}」（编号 ${asset.id}），图也从库里一并删掉。病例的当前内容会变，版本 +1；正在进行的会话仍用它们开始时的内容。`,
			confirmLabel: "确认删除",
			danger: true,
		});
		if (ok) deleteMutation.mutate(asset.id);
	};

	const openDraft = (asset: ScenarioAdminAsset) => {
		setDraft({
			asset,
			file: null,
			title: asset.title,
			alt: asset.alt,
		});
	};

	const copyRef = async (id: string) => {
		try {
			await navigator.clipboard.writeText(assetRef(id));
			toast.success(`已复制 ${id} 的引用`);
		} catch {
			toast.error("复制失败，请手动选中后复制");
		}
	};

	const draftLabel = draft
		? assets.some((item) => item.id === draft.asset.id && item.uploaded)
			? "替换图片"
			: "上传这张图"
		: "";

	return (
		<Stack gap="md">
			<Text size="xs" c="dimmed">
				当前版本 #{pack.version}。上传、替换、删除图片都会改动病例的当前内容（内容变了版本 +1）；
				正在进行的会话仍按它们开始时的内容取图，取到的字节则是当下这一份。
			</Text>

			<Paper withBorder p="md">
				<Text fw={600} mb={4}>
					上传图片
				</Text>
				<Text size="xs" c="dimmed" mb="sm">
					支持 PNG / JPEG / WebP / GIF，单张上限 8&nbsp;MB；保存时会统一转成 WebP 并去掉照片自带的拍摄信息。
					<br />
					用一个新编号上传 = 把这张图的声明写进病例的当前内容；编号已经有了，上传就是用新图顶替它
					（只换图、其他没动时不会多出一条版本）。失败时病例和旧图都不变。
				</Text>
				<Group align="flex-end" gap="sm" wrap="wrap">
					<TextInput
						label="图片编号"
						description="病例里就用它引用这张图"
						placeholder="a_room"
						value={assetId}
						onChange={(event) => setAssetId(event.currentTarget.value)}
						w={180}
						required
					/>
					<TextInput
						label="标题"
						placeholder="病房环境"
						value={title}
						onChange={(event) => setTitle(event.currentTarget.value)}
						w={200}
					/>
					<TextInput
						label="替代文本"
						description="看不到图的人读到的描述"
						placeholder="夜班病房，监护仪在响"
						value={alt}
						onChange={(event) => setAlt(event.currentTarget.value)}
						w={240}
					/>
					<FileInput
						label="图片文件"
						placeholder="选择图片"
						accept={IMAGE_ACCEPT}
						value={file}
						onChange={setFile}
						w={220}
						required
					/>
					<Button
						loading={uploadMutation.isPending}
						disabled={!file || assetId.trim().length === 0}
						onClick={() =>
							file &&
							uploadMutation.mutate({
								asset_id: assetId.trim(),
								file,
								title: title.trim(),
								alt: alt.trim(),
							})
						}
					>
						上传并保存
					</Button>
				</Group>
			</Paper>

			{assets.length === 0 ? (
				<Text size="sm" c="dimmed">
					这个病例没有声明任何图片（内容里没有这一项）。
				</Text>
			) : (
				<Table.ScrollContainer minWidth={1000}>
					<Table highlightOnHover verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>图片</Table.Th>
								<Table.Th>替代文本</Table.Th>
								<Table.Th>文件</Table.Th>
								<Table.Th>状态</Table.Th>
								<Table.Th>病例里的引用</Table.Th>
								<Table.Th>操作</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{assets.map((asset) => (
								<Table.Tr key={asset.id}>
									<Table.Td>
										<Text fw={600}>{asset.title || asset.id}</Text>
										<Code>{asset.id}</Code>
									</Table.Td>
									<Table.Td>
										<Text size="xs">{asset.alt || "—"}</Text>
									</Table.Td>
									<Table.Td>
										<Text size="xs">{asset.filename || "—"}</Text>
										<Text size="xs" c="dimmed">
											{asset.mime_type || "—"} · {formatBytes(asset.file_size)}
										</Text>
									</Table.Td>
									<Table.Td>
										{asset.uploaded ? (
											<Badge color="green" variant="light">
												已上传
											</Badge>
										) : (
											<Badge color="red" variant="filled">
												未上传
											</Badge>
										)}
									</Table.Td>
									<Table.Td>
										<Group gap="xs" wrap="nowrap">
											<Code>{assetRef(asset.id)}</Code>
											<Button
												size="compact-xs"
												variant="subtle"
												onClick={() => copyRef(asset.id)}
											>
												复制
											</Button>
										</Group>
									</Table.Td>
									<Table.Td>
										<Group gap="xs" wrap="nowrap">
											<Button
												size="compact-sm"
												variant="light"
												disabled={!asset.uploaded}
												onClick={() => {
													setPreview(asset);
													bumpPreview();
												}}
											>
												预览
											</Button>
											<Button
												size="compact-sm"
												variant="light"
												onClick={() => openDraft(asset)}
											>
												{asset.uploaded ? "替换图片" : "上传这张"}
											</Button>
											<Button
												size="compact-sm"
												variant="subtle"
												color="red"
												loading={deleteMutation.isPending}
												onClick={() => removeAsset(asset)}
											>
												删除
											</Button>
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}

			{draft && (
				<Modal
					opened
					onClose={() => setDraft(null)}
					title={`${draftLabel}：${draft.asset.id}`}
					size="lg"
					centered
				>
					<Stack gap="sm">
						<Text size="xs" c="dimmed">
							{draftLabel === "替换图片"
								? "保存后病例里这个编号就指向新图，没有新旧两份；图按编号只存一份，正在进行的会话取到的也是新图。只换了图、其他没动的话版本不变；保存失败时旧图原样保留。"
								: "病例里已经声明了这个编号，但库里还没有它的图。选一张图保存即可，学生端就能取到。"}
						</Text>
						<TextInput label="图片编号" value={draft.asset.id} readOnly />
						<TextInput
							label="标题"
							value={draft.title}
							onChange={(event) =>
								setDraft((current) =>
									current
										? { ...current, title: event.currentTarget.value }
										: current,
								)
							}
						/>
						<TextInput
							label="替代文本"
							description="看不到图的人读到的描述"
							value={draft.alt}
							onChange={(event) =>
								setDraft((current) =>
									current
										? { ...current, alt: event.currentTarget.value }
										: current,
								)
							}
						/>
						<FileInput
							label="图片文件"
							placeholder="选择图片"
							accept={IMAGE_ACCEPT}
							value={draft.file}
							onChange={(next) =>
								setDraft((current) => (current ? { ...current, file: next } : current))
							}
							required
						/>
						<Group justify="flex-end" gap="sm">
							<Button variant="default" onClick={() => setDraft(null)}>
								取消
							</Button>
							<Button
								loading={saveDraftMutation.isPending || replaceMutation.isPending}
								disabled={!draft.file}
								onClick={() => {
									if (!draft.file) return;
									const payload = {
										file: draft.file,
										title: draft.title.trim(),
										alt: draft.alt.trim(),
									};
									// 已经有字节 → 替换（`asset_id` 在路径上）；还没字节 → 新建声明
									if (draft.asset.uploaded) {
										replaceMutation.mutate({
											assetId: draft.asset.id,
											payload,
										});
									} else {
										saveDraftMutation.mutate({
											asset_id: draft.asset.id,
											...payload,
										});
									}
								}}
							>
								保存
							</Button>
						</Group>
					</Stack>
				</Modal>
			)}

			<Modal
				opened={preview !== null}
				onClose={() => setPreview(null)}
				title={preview ? `预览：${preview.title || preview.id}` : "预览"}
				size="lg"
				centered
			>
				{preview && (
					<Stack gap="xs">
						<AuthImage
							alt={preview.alt || preview.title || preview.id}
							src={`${scenarioAssetSrc(pack.key, preview.id)}?v=${previewNonce}`}
							className="sc-modal-image"
						/>
						<Text size="xs" c="dimmed">
							{preview.filename || "—"} · {formatBytes(preview.file_size)}
						</Text>
						<Group gap="xs">
							<Text size="xs">病例里的引用</Text>
							<Code>{assetRef(preview.id)}</Code>
							<Button
								size="compact-xs"
								variant="subtle"
								onClick={() => copyRef(preview.id)}
							>
								复制
							</Button>
						</Group>
					</Stack>
				)}
			</Modal>
		</Stack>
	);
}
