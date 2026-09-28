import { Badge, Button, Code, Group, Paper, Stack, Table, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import {
	patchAdminScenarioPack,
	type ScenarioAdminPack,
	type ScenarioPackState,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorDetail } from "@/utils/error";

/**
 * 修订 —— 这份病例的**历史与定稿状态**。
 *
 * 两件事，各有唯一入口：
 * - 修订历史：平台每次写入都追加一条（上传包 JSON、传/撤图片字节），`note` 就是那一次的
 *   **变更记录**（如 `asset:a_room by 20` / `drop asset:a_verify`）——这里逐条如实呈现。
 *   内容级逐字段比对需要读**历史修订的内容**，当前没有任何接口提供它（且历史修订未必还能过
 *   当今 schema 的校验），所以不在这里假装有；需要它就得新加一个只读端点。
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
								（id {pack.revision_id ?? "—"}）· 共 {pack.revisions.length} 个修订 ·{" "}
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
					已经在跑的会话仍用它们开始时的修订。
				</Text>
				{pack.revisions.length === 0 ? (
					<Text size="sm" c="dimmed">
						这份病例还没有任何修订。
					</Text>
				) : (
					<Table.ScrollContainer minWidth={520}>
						<Table verticalSpacing="xs">
							<Table.Thead>
								<Table.Tr>
									<Table.Th>修订</Table.Th>
									<Table.Th>变更说明</Table.Th>
									<Table.Th>id</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{pack.revisions.map((revision) => (
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
											<Code>{revision.id}</Code>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</Table.ScrollContainer>
				)}
			</Paper>
		</Stack>
	);
}
