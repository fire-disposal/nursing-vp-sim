import { Badge, Code, Group, Paper, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import type { ScenarioAdminPack } from "@/api/scenario";
import { PRESENCE_HINT } from "../actors";

/** 一行"名 → 值"：概览里所有标量字段共用一种排法（不各写一套）。 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<Text size="xs" c="dimmed">
				{label}
			</Text>
			<Text size="sm">{children}</Text>
		</div>
	);
}

/**
 * 概览 —— 这份病例**声明了什么**（作者视角的一页事实，不是学生页的摘要）。
 *
 * 数据全部来自 `GET /scenario/admin/packs` 的 `overview` 投影（最新修订）：
 * 角色 / 场景 / 在场者 / **教学关注点声明** / 各栏规模。DM 侧的真相字段（`truth`、
 * `hidden_from_player`、actor 的 knowledge）**一个都不在这里**——管理界面要的是"作者声明了什么"，
 * 不是"患者藏着什么"，少一处副本就少一处泄漏面。
 *
 * 状态在这里只**显示**（改状态是「修订」那一块的事）：同一个事实不提供两个写入口。
 */
export default function AdminCaseOverviewPanel({ pack }: { pack: ScenarioAdminPack }) {
	// `overview` 与它的集合字段在生成物里都是可选的：缺就当"没有声明"渲染，不当作空对象硬读。
	const overview = pack.overview ?? null;
	const assets = pack.assets ?? [];
	const resources = overview?.resources ?? [];
	const actors = overview?.actors ?? [];
	const teachingFocus = overview?.teaching_focus ?? [];
	const uploaded = assets.filter((asset) => asset.uploaded).length;

	return (
		<Stack gap="md">
			<Paper withBorder p="md">
				<Group gap="xs" mb={6} wrap="wrap">
					<Text fw={600}>{pack.title}</Text>
					<Badge variant="light" color={pack.state === "reviewed" ? "green" : "gray"}>
						{pack.state === "reviewed" ? "已审" : "实验版"}
					</Badge>
					<Code>{pack.key}</Code>
				</Group>
				<Text size="sm" c="dimmed">
					{pack.one_line || "（没有一句话说明）"}
				</Text>
			</Paper>

			{overview === null ? (
				<Text size="sm" c="dimmed">
					这份病例还没有可读的修订（最新修订加载不出来），所以看不到声明内容。
				</Text>
			) : (
				<>
					<Paper withBorder p="md">
						<SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
							<Field label="你将扮演谁">{overview.player_role || "—"}</Field>
							<Field label="场景">
								{overview.place || "—"}
								{overview.time_hint !== "" && ` · ${overview.time_hint}`}
							</Field>
							<Field label="手边有什么">
								{resources.length === 0 ? "—" : resources.join("、")}
							</Field>
							<Field label="当前修订">
								#{pack.revision_no ?? "—"}（id {pack.revision_id ?? "—"}）
							</Field>
							<Field label="会话">{pack.sessions} 次</Field>
							<Field label="结算口径">
								{overview.failure === "irreversible" ? "可失败到不可逆" : "可恢复"}
								{" · 图像生成"}
								{overview.image_generation === "allowed" ? "已开启" : "关闭"}
							</Field>
						</SimpleGrid>
					</Paper>

					<Paper withBorder p="md">
						<Text fw={600} mb={6}>
							声明规模
						</Text>
						<SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="md">
							<Field label="现场线索">{overview.cues}</Field>
							<Field label="动作">{overview.affordances}</Field>
							<Field label="反应">{overview.reactions}</Field>
							<Field label="观察点">{overview.facts}</Field>
							<Field label="判据">
								{overview.criteria}（权重合计 {overview.criteria_weight}）
							</Field>
						</SimpleGrid>
						<Text size="xs" c="dimmed" mt="xs">
							资源：{assets.length} 张，已上传 {uploaded} 张
							{assets.length > uploaded && `，缺 ${assets.length - uploaded} 张字节`}
						</Text>
					</Paper>

					<Paper withBorder p="md">
						<Text fw={600} mb={6}>
							在场者（{actors.length}）
						</Text>
						{actors.length === 0 ? (
							<Text size="sm" c="dimmed">
								这份病例没有声明在场者。
							</Text>
						) : (
							<Table verticalSpacing="xs">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>id</Table.Th>
										<Table.Th>身份</Table.Th>
										<Table.Th>接触方式</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{actors.map((actor) => (
										<Table.Tr key={actor.id}>
											<Table.Td>
												<Code>{actor.id}</Code>
											</Table.Td>
											<Table.Td>{actor.role}</Table.Td>
											<Table.Td>
												<Text size="xs">
													<Code>{actor.presence}</Code>
													{PRESENCE_HINT[actor.presence]
														? `（${PRESENCE_HINT[actor.presence]}）`
														: "（看得见、说不上话）"}
												</Text>
											</Table.Td>
										</Table.Tr>
									))}
								</Table.Tbody>
							</Table>
						)}
					</Paper>

					<Paper withBorder p="md">
						<Text fw={600} mb={6}>
							教学关注点（{teachingFocus.length}）
						</Text>
						<Text size="xs" c="dimmed" mb={6}>
							作者希望学生遇到的判断问题（只给 DM 与教师看，不是给学生的提示清单）；
							「已处理」只代表本包观察到了处理证据，不等于能力达标。
						</Text>
						{teachingFocus.length === 0 ? (
							<Text size="sm" c="dimmed">
								没有声明教学关注点：这份病例不预设判断问题，DM 按常规时间推进。
							</Text>
						) : (
							<Table verticalSpacing="xs">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>id</Table.Th>
										<Table.Th>教学意图</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{teachingFocus.map((focus) => (
										<Table.Tr key={focus.id}>
											<Table.Td>
												<Code>{focus.id}</Code>
											</Table.Td>
											<Table.Td>
												<Text size="xs">{focus.intent}</Text>
											</Table.Td>
										</Table.Tr>
									))}
								</Table.Tbody>
							</Table>
						)}
					</Paper>
				</>
			)}
		</Stack>
	);
}
