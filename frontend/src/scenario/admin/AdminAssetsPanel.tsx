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
	adminScenarioAssetSrc,
	deleteAdminScenarioAsset,
	type ScenarioAdminAsset,
	type ScenarioAdminPack,
	type ScenarioAssetUploadInput,
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

/**
 * 资源：声明清单 + **上传图片字节** + 预览 + 撤下。
 *
 * 声明（`asset_id`/标题/说明）可以随包 JSON 一起来，但**字节必须在这里传**：
 * `uploaded=false` 就是"作者写了这张图、库里还没有它"，学生端取图会 404。
 * 上传走 `AuthImage` 同一套鉴权（Bearer → blob），所以预览能证明字节真的存进去了。
 *
 * 上传即**追加一个新修订**（后端把声明与字节一起版本化），所以传完修订号会 +1。
 *
 * 病例由调用方（工作区头部）给定——这里**没有选择器**：同一个病例不会有两个"当前"。
 */
export default function AdminAssetsPanel({ pack }: { pack: ScenarioAdminPack }) {
	const [assetId, setAssetId] = useState("");
	const [title, setTitle] = useState("");
	const [alt, setAlt] = useState("");
	const [suggestWhen, setSuggestWhen] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<ScenarioAdminAsset | null>(null);
	const [previewNonce, setPreviewNonce] = useState(0);
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });

	const uploadMutation = useMutation({
		mutationFn: (payload: ScenarioAssetUploadInput) =>
			uploadAdminScenarioAsset(pack.key, payload),
		onSuccess: (data) => {
			toast.success(`${data.asset.id}：图片已保存`, {
				description: `已追加修订 #${data.revision_no}（${formatBytes(data.asset.file_size)}）`,
			});
			setAssetId("");
			setTitle("");
			setAlt("");
			setSuggestWhen("");
			setFile(null);
			setPreview(data.asset);
			setPreviewNonce((n) => n + 1);
			invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "上传图片失败")),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => deleteAdminScenarioAsset(pack.key, id),
		onSuccess: (_data, id) => {
			toast.success(`${id}：已撤下`);
			setPreview((current) => (current?.id === id ? null : current));
			invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "撤下资源失败")),
	});

	const removeAsset = async (asset: ScenarioAdminAsset) => {
		const ok = await confirm({
			title: `撤下 ${asset.id}`,
			message:
				"声明会从新修订里移除，字节在不再被任何修订引用时一并删除。已在跑的会话仍用它们开始时的修订。",
			confirmLabel: "确认撤下",
			danger: true,
		});
		if (ok) deleteMutation.mutate(asset.id);
	};

	return (
		<Stack gap="md">
			<Text size="xs" c="dimmed">
				当前修订 #{pack.revision_no ?? "—"}；上传图片会追加新修订。
			</Text>

			<Paper withBorder p="md">
				<Text fw={600} mb={4}>
					上传图片
				</Text>
				<Text size="xs" c="dimmed" mb="sm">
					支持 PNG / JPEG / WebP / GIF，单张上限 8&nbsp;MB。
					<Code>asset_id</Code> 要与包 JSON 里声明的 id 一致；
					不存在也没关系——服务端会把它作为新的资源声明写进新修订。
				</Text>
				<Group align="flex-end" gap="sm" wrap="wrap">
					<TextInput
						label="asset_id"
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
						label="alt 文本"
						placeholder="夜班病房，监护仪在响"
						value={alt}
						onChange={(event) => setAlt(event.currentTarget.value)}
						w={260}
					/>
					<TextInput
						label="展示时机"
						placeholder="开场时让学生对所处环境有画面感"
						value={suggestWhen}
						onChange={(event) => setSuggestWhen(event.currentTarget.value)}
						w={300}
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
								suggest_when: suggestWhen.trim(),
							})
						}
					>
						上传并保存
					</Button>
				</Group>
			</Paper>

			{pack.assets.length === 0 ? (
				<Text size="sm" c="dimmed">
					这个病例没有声明任何资源。
				</Text>
			) : (
				<Table.ScrollContainer minWidth={880}>
					<Table highlightOnHover verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>资源</Table.Th>
								<Table.Th>alt / 展示提示</Table.Th>
								<Table.Th>文件</Table.Th>
								<Table.Th>状态</Table.Th>
								<Table.Th>操作</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{pack.assets.map((asset) => (
								<Table.Tr key={asset.id}>
									<Table.Td>
										<Text fw={600}>{asset.title || asset.id}</Text>
										<Code>{asset.id}</Code>
									</Table.Td>
									<Table.Td>
										<Text size="xs">{asset.alt || "—"}</Text>
										<Text size="xs" c="dimmed">
											{asset.suggest_when || "—"}
										</Text>
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
										<Group gap="xs">
											<Button
												size="compact-sm"
												variant="light"
												disabled={!asset.uploaded}
												onClick={() => {
													setPreview(asset);
													setPreviewNonce((n) => n + 1);
												}}
											>
												预览
											</Button>
											<Button
												size="compact-sm"
												variant="subtle"
												color="red"
												loading={deleteMutation.isPending}
												onClick={() => removeAsset(asset)}
											>
												撤下
											</Button>
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
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
							key={`${preview.id}-${previewNonce}`}
							alt={preview.alt || preview.title || preview.id}
							src={adminScenarioAssetSrc(pack.key, preview.id)}
							className="sc-modal-image"
						/>
						<Text size="xs" c="dimmed">
							{preview.filename || "—"} · {formatBytes(preview.file_size)}
						</Text>
					</Stack>
				)}
			</Modal>
		</Stack>
	);
}
