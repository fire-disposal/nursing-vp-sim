import {
	Badge,
	Button,
	Code,
	FileInput,
	Group,
	Loader,
	Paper,
	Select,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	listAdminScenarioPacks,
	patchAdminScenarioPack,
	type ScenarioAdminPack,
	type ScenarioPackState,
	uploadAdminScenarioPack,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorDetail } from "@/utils/error";

const STATE_OPTIONS: { value: ScenarioPackState; label: string }[] = [
	{ value: "experimental", label: "实验版" },
	{ value: "reviewed", label: "已审" },
];

/**
 * 情境包：列表（状态 / 修订号 / 会话数 / 资源上传进度）+ 上传包 JSON + 改状态。
 *
 * 上传是**追加新修订**，不是覆盖：同一份内容再传一次是幂等的（服务端返回 `created=false`），
 * 所以这里如实回报「新增了修订」还是「与现有修订一致」。
 */
export default function AdminPacksPanel({
	onManageAssets,
}: {
	onManageAssets: (packKey: string) => void;
}) {
	const [file, setFile] = useState<File | null>(null);
	const [note, setNote] = useState("");
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const packsQuery = useQuery({
		queryKey: queryKeys.scenario.admin.packs(),
		queryFn: listAdminScenarioPacks,
	});
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });

	const uploadMutation = useMutation({
		mutationFn: uploadAdminScenarioPack,
		onSuccess: (data) => {
			const pending = data.assets_pending;
			toast.success(
				data.created
					? `${data.key}：已新增修订 #${data.revision_no}`
					: `${data.key}：内容与现有修订一致，未新增`,
				{
					description:
						pending.length > 0
							? `还有 ${pending.length} 个资源声明没有字节，去「资源」里上传。`
							: undefined,
				},
			);
			setFile(null);
			setNote("");
			invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "上传情境包失败")),
	});

	const stateMutation = useMutation({
		mutationFn: ({ key, state }: { key: string; state: ScenarioPackState }) =>
			patchAdminScenarioPack(key, { state }),
		onSuccess: (data) => {
			toast.success(`${data.title}：状态改为 ${data.state}`);
			invalidate();
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "更新情境包失败")),
	});

	const changeState = async (pack: ScenarioAdminPack, next: ScenarioPackState) => {
		if (next === pack.state) return;
		// 状态是**落库的标记**（`reviewed` = 已审阅）：误点一次就改口径，所以要问一句
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

	const packs = packsQuery.data ?? [];

	return (
		<Stack gap="md">
			<Paper withBorder p="md">
				<Text fw={600} mb={4}>
					上传情境包（JSON）
				</Text>
				<Text size="xs" c="dimmed" mb="sm">
					上传即追加一个新修订：已经在跑的会话仍用它们开始时的修订。
					资源图片的字节不在这里，去「资源」里传。
				</Text>
				<Group align="flex-end" gap="sm" wrap="wrap">
					<FileInput
						label="包 JSON"
						placeholder="选择 .json 文件"
						accept="application/json,.json"
						value={file}
						onChange={setFile}
						w={280}
					/>
					<TextInput
						label="修订说明"
						placeholder="例如：补上第二条线索"
						value={note}
						onChange={(event) => setNote(event.currentTarget.value)}
						w={280}
					/>
					<Button
						onClick={() => file && uploadMutation.mutate({ file, note })}
						disabled={!file}
						loading={uploadMutation.isPending}
					>
						上传
					</Button>
				</Group>
			</Paper>

			{packsQuery.isLoading ? (
				<Group justify="center" py="xl">
					<Loader size="sm" />
				</Group>
			) : packsQuery.isError ? (
				<Text c="red" size="sm">
					情境包列表读取失败：请确认权限，或稍后重试。
				</Text>
			) : packs.length === 0 ? (
				<Text size="sm" c="dimmed">
					还没有情境包。先上传一份包 JSON。
				</Text>
			) : (
				<Table.ScrollContainer minWidth={860}>
					<Table highlightOnHover verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>情境包</Table.Th>
								<Table.Th>状态</Table.Th>
								<Table.Th>修订</Table.Th>
								<Table.Th>会话</Table.Th>
								<Table.Th>资源</Table.Th>
								<Table.Th>操作</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{packs.map((pack) => {
								const uploaded = pack.assets.filter((a) => a.uploaded).length;
								const missing = pack.assets.length - uploaded;
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
											<Select
												size="xs"
												w={110}
												data={STATE_OPTIONS}
												value={pack.state}
												allowDeselect={false}
												disabled={stateMutation.isPending}
												onChange={(value) =>
													value && void changeState(pack, value as ScenarioPackState)
												}
												aria-label={`${pack.title} 的状态`}
											/>
										</Table.Td>
										<Table.Td>
											<Text size="sm">#{pack.revision_no ?? "—"}</Text>
											<Text size="xs" c="dimmed">
												{pack.revisions.length} 个修订
											</Text>
										</Table.Td>
										<Table.Td>
											<Text size="sm">{pack.sessions}</Text>
										</Table.Td>
										<Table.Td>
											{pack.assets.length === 0 ? (
												<Text size="xs" c="dimmed">
													未声明资源
												</Text>
											) : (
												<Group gap={6}>
													<Badge
														color={missing > 0 ? "orange" : "green"}
														variant="light"
													>
														{uploaded}/{pack.assets.length} 已上传
													</Badge>
													{missing > 0 && (
														<Text size="xs" c="orange">
															缺 {missing} 个字节
														</Text>
													)}
												</Group>
											)}
											{pack.assets.length > 0 &&
												missing > 0 && (
													<Text size="xs" c="dimmed" mt={4}>
														未上传：
														<Code>
															{pack.assets
																.filter((a) => !a.uploaded)
																.map((a) => a.id)
																.join(", ")}
														</Code>
													</Text>
												)}
										</Table.Td>
										<Table.Td>
											<Group gap="xs">
												<Button
													size="compact-sm"
													variant="light"
													onClick={() => onManageAssets(pack.key)}
												>
													管理资源
												</Button>
											</Group>
										</Table.Td>
									</Table.Tr>
								);
							})}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}
		</Stack>
	);
}
