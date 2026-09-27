import {
	Badge,
	Button,
	Code,
	Group,
	Loader,
	Modal,
	Pagination,
	Paper,
	Select,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	adminGeneratedAssetSrc,
	deleteAdminGeneratedAsset,
	listAdminGeneratedAssets,
	listAdminScenarioPacks,
	type ScenarioGeneratedAsset,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import AuthImage from "@/components/ui/auth-image";
import { useConfirm } from "@/components/ui/confirm";
import { formatDateTime } from "@/utils/date";
import { getApiErrorDetail, getApiErrorMessage } from "@/utils/error";

const PAGE_SIZE = 20;

function formatBytes(size: number): string {
	if (!size) return "—";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** 缩略图：字节取不到（如已被清理）就说明白，不留空框、不显示破图。 */
function GeneratedThumb({
	item,
	onOpen,
}: {
	item: ScenarioGeneratedAsset;
	onOpen: () => void;
}) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return (
			<Text size="xs" c="dimmed">
				该图已被清理
			</Text>
		);
	}
	return (
		<button
			type="button"
			className="sc-thumb"
			onClick={onOpen}
			aria-label={`预览生成物 #${item.id}`}
		>
			<AuthImage
				alt={item.prompt.slice(0, 40)}
				src={adminGeneratedAssetSrc(item.id)}
				onStatus={(status) => setFailed(status === "error")}
			/>
		</button>
	);
}

/**
 * 生成物：**某个病例**运行期由 DM 生成的图片（病例二级界面的一块，与 资源 同级）。
 *
 * 与「资源」的分工：资源是**作者准备的**（包 JSON 声明 + 管理侧上传）；
 * 生成物是**运行期长出来的**（哪个学生、哪次会话、什么 prompt 生成的），只增不减地留痕，
 * 所以这里按会话/病例筛、可以按图删单条，但**不提供编辑**。
 *
 * 分页走服务端（默认 20/页）：面板只拉当前页，`total` 是该病例下的总数。
 */
export default function AdminGeneratedPanel({
	packKey,
	onPackKeyChange,
	onOpenSession,
}: {
	packKey: string | null;
	onPackKeyChange: (key: string | null) => void;
	/** 点会话 id 跳到会话回放（由页面切页签并把会话带过去）。 */
	onOpenSession?: (sessionId: number) => void;
}) {
	const [page, setPage] = useState(1);
	const [sessionFilter, setSessionFilter] = useState("");
	const [preview, setPreview] = useState<ScenarioGeneratedAsset | null>(null);
	const [previewNonce, setPreviewNonce] = useState(0);
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const packsQuery = useQuery({
		queryKey: queryKeys.scenario.admin.packs(),
		queryFn: listAdminScenarioPacks,
	});
	const sessionId = /^\d+$/.test(sessionFilter.trim())
		? Number(sessionFilter.trim())
		: null;
	const offset = (page - 1) * PAGE_SIZE;

	const listQuery = useQuery({
		queryKey: queryKeys.scenario.admin.generated({
			pack_key: packKey,
			limit: PAGE_SIZE,
			offset,
			session_id: sessionId,
		}),
		queryFn: () =>
			listAdminGeneratedAssets(packKey ?? "", {
				limit: PAGE_SIZE,
				offset,
				session_id: sessionId,
			}),
		enabled: packKey !== null,
		retry: false,
	});

	// 换病例/换筛选 → 回到第一页（否则会停在一个不存在的页码上）
	useEffect(() => {
		setPage(1);
	}, [packKey, sessionId]);

	const total = listQuery.data?.total ?? 0;
	const items = listQuery.data?.items ?? [];
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteAdminGeneratedAsset(id),
		onSuccess: async (_data, id) => {
			toast.success(`生成物 #${id} 已删除`);
			setPreview((current) => (current?.id === id ? null : current));
			// 当前页删空 → 回退一页（不停在空列表上）
			if (items.length === 1 && page > 1) setPage((current) => current - 1);
			await queryClient.invalidateQueries({
				queryKey: queryKeys.scenario.admin.all,
			});
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "删除生成物失败")),
	});

	const remove = async (item: ScenarioGeneratedAsset) => {
		const ok = await confirm({
			title: `删除生成物 #${item.id}？`,
			message: `这次会话（#${item.session_id}）里由 DM 生成的图片会被永久删除：${
				item.prompt.slice(0, 80) || "—"
			}`,
			confirmLabel: "确认删除",
			danger: true,
		});
		if (ok) deleteMutation.mutate(item.id);
	};

	const packs = packsQuery.data ?? [];
	const selected = packs.find((pack) => pack.key === packKey) ?? null;

	if (packsQuery.isLoading) {
		return (
			<Group justify="center" py="xl">
				<Loader size="sm" />
			</Group>
		);
	}

	if (packsQuery.isError) {
		return (
			<Stack align="flex-start" gap="xs">
				<Text size="sm" c="red">
					病例列表读取失败：{getApiErrorMessage(packsQuery.error, "请稍后重试")}
				</Text>
				<Button size="compact-sm" variant="light" onClick={() => packsQuery.refetch()}>
					重试
				</Button>
			</Stack>
		);
	}

	if (packs.length === 0) {
		return (
			<Text size="sm" c="dimmed">
				还没有情境包——先在「情境包」里上传一份，再来看它的生成物。
			</Text>
		);
	}

	const isUnavailable =
		listQuery.error !== null &&
		listQuery.error !== undefined &&
		typeof listQuery.error === "object" &&
		"response" in listQuery.error &&
		(listQuery.error as { response?: { status?: number } }).response?.status === 404;

	return (
		<Stack gap="md">
			<Group align="flex-end" gap="sm" wrap="wrap">
				<Select
					label="病例"
					w={260}
					placeholder="选一个病例"
					value={packKey}
					onChange={onPackKeyChange}
					data={packs.map((pack) => ({
						value: pack.key,
						label: `${pack.title}（${pack.key}）`,
					}))}
					aria-label="病例"
				/>
				<TextInput
					label="按会话筛选"
					w={160}
					placeholder="会话 id"
					value={sessionFilter}
					onChange={(event) =>
						setSessionFilter(event.currentTarget.value.replace(/[^\d]/g, ""))
					}
					aria-label="按会话筛选"
				/>
				{packKey !== null && (
					<Text size="xs" c="dimmed" pb={6}>
						共 {total} 件 · 第 {page}/{pages} 页
					</Text>
				)}
			</Group>

			{packKey === null ? (
				<Text size="sm" c="dimmed">
					先选一个病例，就能看到它运行期生成过哪些图片。
				</Text>
			) : listQuery.isLoading ? (
				<Group justify="center" py="xl">
					<Loader size="sm" />
				</Group>
			) : listQuery.isError ? (
				<Stack align="flex-start" gap="xs">
					<Text size="sm" c={isUnavailable ? "dimmed" : "red"}>
						{isUnavailable
							? "生成物接口在当前环境不可用。"
							: `生成物读取失败：${getApiErrorMessage(listQuery.error, "请稍后重试")}`}
					</Text>
					<Button
						size="compact-sm"
						variant="light"
						onClick={() => listQuery.refetch()}
					>
						重试
					</Button>
				</Stack>
			) : items.length === 0 ? (
				<Text size="sm" c="dimmed">
					{selected
						? sessionId === null
							? "该病例还没有 DM 生成物。"
							: `会话 #${sessionId} 没有生成物。`
						: "该病例还没有 DM 生成物。"}
				</Text>
			) : (
				<>
					<Table.ScrollContainer minWidth={900}>
						<Table highlightOnHover verticalSpacing="sm">
							<Table.Thead>
								<Table.Tr>
									<Table.Th>图</Table.Th>
									<Table.Th>会话</Table.Th>
									<Table.Th>prompt</Table.Th>
									<Table.Th>文件</Table.Th>
									<Table.Th>生成时间</Table.Th>
									<Table.Th>操作</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{items.map((item) => (
									<Table.Tr key={item.id}>
										<Table.Td>
											<GeneratedThumb
												item={item}
												onOpen={() => {
													setPreview(item);
													setPreviewNonce((n) => n + 1);
												}}
											/>
										</Table.Td>
										<Table.Td>
											<Button
												size="compact-xs"
												variant="subtle"
												disabled={!onOpenSession}
												onClick={() => onOpenSession?.(item.session_id)}
											>
												#{item.session_id}
											</Button>
											<Text size="xs" c="dimmed">
												{item.pack_key} · rev {item.pack_revision_id}
											</Text>
										</Table.Td>
										<Table.Td maw={320}>
											<Text size="sm" lineClamp={2} title={item.prompt}>
												{item.prompt || "—"}
											</Text>
										</Table.Td>
										<Table.Td>
											<Badge variant="light">{item.kind}</Badge>
											<Text size="xs" c="dimmed">
												{item.mime_type} · {formatBytes(item.file_size)}
											</Text>
											<Code>{item.sha256.slice(0, 10)}…</Code>
										</Table.Td>
										<Table.Td>
											<Text size="xs">{formatDateTime(item.created_at)}</Text>
										</Table.Td>
										<Table.Td>
											<Group gap="xs">
												<Button
													size="compact-sm"
													variant="light"
													onClick={() => {
														setPreview(item);
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
													onClick={() => remove(item)}
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

					<Group justify="space-between">
						<Text size="xs" c="dimmed">
							第 {offset + 1}–{offset + items.length} 件，共 {total} 件
						</Text>
						{pages > 1 && (
							<Pagination
								total={pages}
								value={page}
								onChange={setPage}
								size="sm"
								withEdges
								aria-label="生成物分页"
							/>
						)}
					</Group>
				</>
			)}

			<Modal
				opened={preview !== null}
				onClose={() => setPreview(null)}
				title={preview ? `生成物 #${preview.id}（会话 #${preview.session_id}）` : "预览"}
				size="xl"
				centered
			>
				{preview && (
					<Stack gap="xs">
						<AuthImage
							key={`${preview.id}-${previewNonce}`}
							alt={preview.prompt.slice(0, 60)}
							src={adminGeneratedAssetSrc(preview.id)}
							className="sc-modal-image"
						/>
						<Paper withBorder p="xs">
							<Text size="xs" c="dimmed">
								prompt
							</Text>
							<Text size="sm">{preview.prompt || "—"}</Text>
						</Paper>
						<Text size="xs" c="dimmed">
							{preview.mime_type} · {formatBytes(preview.file_size)} ·{" "}
							{formatDateTime(preview.created_at)} · sha256 {preview.sha256}
						</Text>
					</Stack>
				)}
			</Modal>
		</Stack>
	);
}
