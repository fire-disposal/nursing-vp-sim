import {
	Accordion,
	Badge,
	Code,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Table,
	Text,
} from "@mantine/core";
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
 * 在场者"怎么接触"：**只用** `PRESENCE_HINT` 那一份判据（不在这一页另写一套换算，
 * 两处各写一遍必然会漂）。认不出的取值原样显示，不假装认识。
 */
function contactText(presence: string): string {
	if (presence === "") return "—";
	const hint = PRESENCE_HINT[presence];
	if (hint === undefined) return presence;
	if (hint === "") return "只能看见，问不上话";
	return `可以${hint}`;
}

/**
 * 概览 —— 教师视角的**落地页**：这个病例是什么、学生扮演谁、在哪儿、谁在场、要练什么。
 *
 * 头一块只写病例身份（标题 / 上架状态 / 编号 / 版本 / 一句话），回答"这是什么"；下面四块分别是
 * 角色与地点时间、在场者、教学关注点（要练什么）与可做的动作数。
 *
 * 数据全部来自 `GET /scenario/admin/packs` 的 `overview` 投影（这份病例的当前内容）：
 * 角色 / 地点时间 / 手边有什么 / 在场者 / 教学关注点 / 可做的动作数。DM 侧的真相字段（`truth`、
 * `hidden_from_player`、actor 的 knowledge）**一个都不在这里**——管理界面要的是"作者声明了什么"，
 * 不是"患者藏着什么"，少一处副本就少一处泄漏面。
 *
 * **计数与内部标记不进首屏**：线索/反应/观察点/判据数、失败口径、图片生成声明这些是维护者
 * 核对用的，收在折叠的「维护者信息」里；首屏只回答教师的问题。
 *
 * 那些字段在生成物里都是可选的：缺就当"没有这一项"渲染（整行不出现），不硬读、不拿默认值冒充。
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
					<Badge variant="light" color={pack.published ? "green" : "orange"}>
						{pack.published ? "已上架" : "未上架"}
					</Badge>
					<Code>{pack.key}</Code>
					<Text size="xs" c="dimmed">
						版本 #{pack.version}
						{pack.published_at && ` · 上架于 ${pack.published_at}`}
					</Text>
				</Group>
				<Text size="sm" c="dimmed">
					{pack.one_line || "（没有一句话说明）"}
				</Text>
			</Paper>

			{overview === null ? (
				<Text size="sm" c="dimmed">
					这份病例还没有可读的内容（当前内容读不出来），所以看不到下面的说明。
				</Text>
			) : (
				<>
					<Paper withBorder p="md">
						<Text fw={600} mb={6}>
							学生扮演谁、在哪儿
						</Text>
						<SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
							<Field label="扮演">{overview.player_role || "—"}</Field>
							<Field label="地点">{overview.place || "—"}</Field>
							<Field label="时间">{overview.time_hint || "—"}</Field>
							<Field label="手边有什么">
								{resources.length === 0 ? "—" : resources.join("、")}
							</Field>
						</SimpleGrid>
					</Paper>

					<Paper withBorder p="md">
						<Text fw={600} mb={6}>
							谁在场（{actors.length}）
						</Text>
						{actors.length === 0 ? (
							<Text size="sm" c="dimmed">
								这份病例没有声明在场者。
							</Text>
						) : (
							<Table verticalSpacing="xs">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>谁</Table.Th>
										<Table.Th>怎么接触</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{actors.map((actor) => (
										<Table.Tr key={actor.id}>
											<Table.Td>{actor.role}</Table.Td>
											<Table.Td>
												<Text size="sm">
													{contactText(actor.presence)}
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
							要练什么
						</Text>
						<Text size="xs" c="dimmed" mb={6}>
							作者希望学生在这次训练里遇到的判断问题（教师可见，不是给学生的提示）。
							这里只是作者声明的练习重点，不代表学生是否达标。
						</Text>
						<Text size="sm" mb="xs">
							可以做的动作：{overview.affordances} 个
						</Text>
						{teachingFocus.length === 0 ? (
							<Text size="sm" c="dimmed">
								没有声明教学关注点：这份病例不预设判断问题，训练按常规时间推进。
							</Text>
						) : (
							<Table verticalSpacing="xs">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>教学关注点</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{teachingFocus.map((focus) => (
										<Table.Tr key={focus.id}>
											<Table.Td>
												<Text size="sm">
													{focus.intent || "（没有写教学意图）"}
												</Text>
											</Table.Td>
										</Table.Tr>
									))}
								</Table.Tbody>
							</Table>
						)}
					</Paper>

					<Accordion variant="separated">
						<Accordion.Item value="maintainer">
							<Accordion.Control>
								<Text size="sm">维护者信息</Text>
							</Accordion.Control>
							<Accordion.Panel>
								<Text size="xs" c="dimmed" mb="sm">
									下面这些数字与内部标记用来核对内容，课堂上用不到。
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
									图片：{assets.length} 张，已上传 {uploaded} 张
									{assets.length > uploaded &&
										`，缺 ${assets.length - uploaded} 张字节`}
								</Text>
								<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" mt="sm">
									<Field label="会话">{pack.sessions} 次</Field>
									{overview.failure === "irreversible" ||
									overview.failure === "recoverable" ? (
										<Field label="失败口径">
											{overview.failure === "irreversible"
												? "可失败到不可逆"
												: "可恢复"}
										</Field>
									) : null}
								</SimpleGrid>
							</Accordion.Panel>
						</Accordion.Item>
					</Accordion>
				</>
			)}
		</Stack>
	);
}
