import {
	Badge,
	Button,
	Code,
	FileInput,
	Group,
	Loader,
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
	type ScenarioAdminPack,
	uploadAdminScenarioPack,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { getApiErrorDetail } from "@/utils/error";

/**
 * 病例列表 —— 管理侧「病例」区的**根**：一行一个病例，进入它的工作区。
 *
 * 这里**不是**五个平铺页签之一，而是唯一的病例入口：资源、生成物、会话、统计
 * 全都在"某个病例的工作区"里，所以不再有"选了病例再切页签、选择就没了"这种事。
 *
 * 上传包 JSON 是内容侧动作（`case_manage`）：上传即**追加一个新修订**，
 * 已经在跑的会话仍用它们开始时的修订——所以传完列表里那一行会变，历史不会被改写。
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
	const [note, setNote] = useState("");
	const queryClient = useQueryClient();

	const uploadMutation = useMutation({
		mutationFn: uploadAdminScenarioPack,
		onSuccess: (data) => {
			const pending = data.assets_pending ?? [];
			toast.success(
				data.created
					? `${data.key}：已新增修订 #${data.revision_no}`
					: `${data.key}：内容与现有修订一致，未新增`,
				{
					description:
						pending.length > 0
							? `还有 ${pending.length} 个资源声明没有字节，进这个病例的「资源」里上传。`
							: undefined,
				},
			);
			setFile(null);
			setNote("");
			void queryClient.invalidateQueries({
				queryKey: queryKeys.scenario.admin.all,
			});
		},
		onError: (e) => toast.error(getApiErrorDetail(e, "上传情境包失败")),
	});

	return (
		<Stack gap="md">
			{canContent && (
				<Paper withBorder p="md">
					<Text fw={600} mb={4}>
						上传病例（JSON）
					</Text>
					<Text size="xs" c="dimmed" mb="sm">
						上传即追加一个新修订：已经在跑的会话仍用它们开始时的修订。
						资源图片的字节不在这里——传进病例工作区的「资源」。
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
			)}

			{loading ? (
				<Group justify="center" py="xl">
					<Loader size="sm" />
				</Group>
			) : packs.length === 0 ? (
				<Text size="sm" c="dimmed">
					还没有病例。{canContent ? "先上传一份包 JSON。" : ""}
				</Text>
			) : (
				<Table.ScrollContainer minWidth={880}>
					<Table highlightOnHover verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>病例</Table.Th>
								<Table.Th>状态</Table.Th>
								<Table.Th>修订</Table.Th>
								<Table.Th>会话</Table.Th>
								<Table.Th>资源</Table.Th>
								<Table.Th>操作</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{packs.map((pack) => {
								// `assets` / `revisions` 在生成物里是可选的：缺就是"没声明"，
								// 不把 undefined 拿去 `.length`，也不在下游各处再兜一次。
								const assets = pack.assets ?? [];
								const revisions = pack.revisions ?? [];
								const uploaded = assets.filter((a) => a.uploaded).length;
								const missing = assets.length - uploaded;
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
											<Badge
												variant="light"
												color={pack.state === "reviewed" ? "green" : "gray"}
											>
												{pack.state === "reviewed" ? "已审" : "实验版"}
											</Badge>
										</Table.Td>
										<Table.Td>
											<Text size="sm">#{pack.revision_no ?? "—"}</Text>
											<Text size="xs" c="dimmed">
												{revisions.length} 个修订
											</Text>
										</Table.Td>
										<Table.Td>
											<Text size="sm">{pack.sessions}</Text>
										</Table.Td>
										<Table.Td>
											{assets.length === 0 ? (
												<Text size="xs" c="dimmed">
													未声明资源
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
															缺 {missing} 个字节
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
											<Button
												size="compact-sm"
												variant="light"
												onClick={() => onOpen(pack.key)}
											>
												进入工作区
											</Button>
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
