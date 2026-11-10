import {
	Alert,
	Anchor,
	Badge,
	Button,
	Code,
	Group,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import {
	IconAlertTriangle,
	IconArrowLeft,
	IconBug,
	IconCircleCheck,
	IconRefresh,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
	type BackendErrorGroup,
	type FrontendErrorEntry,
	fetchDiagnose,
	groupLastSeen,
	normalizeFingerprint,
	resolveBackendGroups,
	resolveFrontendGroups,
} from "@/api/admin/ops";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { formatDateTime } from "@/utils/date";

/**
 * `/admin/system-ops/errors/:fingerprint` —— 单个错误组的现场证据。
 *
 * 数据源就是运维页的同一个诊断快照（`queryKeys.diagnose`）：没有独立端点，
 * 因此**同一指纹出现的证据**必须能在当前窗口内重新查到，刷新不会变成"没这条"。
 *
 * 诚实边界（页面文案必须与之一致，不能假装有）：
 * - `request_id` / 处理人 / 已解决状态：档案里没有这些字段 → 不显示，也不造占位值。
 * - 相关版本：只有归档事件自带 `version` 才给 `/admin/versions` 入口；
 *   版本归因页按提示词/rubric/映射聚合，不按 `APP_VERSION` 过滤，故链接只到页面。
 * - 审计：该错误来自日志档案，与审计表无关联列 → 不提供审计链接。
 * - 关联用户：只有前端遥测带 `user_id`，后端错误没有。
 */

const BACK_TO_OPS = "/admin/system-ops";

/** 时间列：档案里是 UTC ISO 串；空值如实显示「—」而不是当前时间。 */
function Stamp({ value }: { value: string | null | undefined }) {
	if (!value) {
		return (
			<Text size="sm" c="dimmed">
				—
			</Text>
		);
	}
	return (
		<Text size="sm" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
			{formatDateTime(value)}
		</Text>
	);
}

function MessageBlock({ message }: { message: string }) {
	return (
		<Code
			block
			style={{
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				fontSize: 12,
				lineHeight: 1.6,
				maxHeight: 320,
				overflow: "auto",
			}}
		>
			{message || "（空消息）"}
		</Code>
	);
}

function BackendEvidence({
	group,
	windowLabel,
	currentWindow,
	lastSeenInWindow,
}: {
	group: BackendErrorGroup;
	windowLabel: string;
	/** 快照自身的滚动窗口（`errors.window`），用于解释「次数按 24h 去重计数」。 */
	currentWindow: string;
	/** 该组最近一次发生是否落在当前窗口内。 */
	lastSeenInWindow: boolean;
}) {
	return (
		<Stack gap="md">
			{!lastSeenInWindow && (
				<Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />} title="已超出当前窗口">
					<Text size="sm">
						该指纹在档案里存在，但最近一次发生早于当前查询窗口（{windowLabel}）。
						它不再出现在运维页的默认列表里，页面仍在显示它是因为你直接打开了这个地址；
						下线前请以此时间戳为准。
					</Text>
				</Alert>
			)}

			<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
				<Card>
					<CardHeader>
						<CardTitle>计数</CardTitle>
					</CardHeader>
					<CardContent>
						<Stack gap={4}>
							<Text size="xl" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
								{group.count.toLocaleString()}
							</Text>
							<Text size="xs" c="dimmed">
								窗口内累计（合计 {currentWindow}）；24h 内已按指纹去重合并
							</Text>
						</Stack>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>首次出现</CardTitle>
					</CardHeader>
					<CardContent>
						<Stack gap={4}>
							<Stamp value={group.first_seen} />
							<Text size="xs" c="dimmed">
								首见事件决定 level 与来源
							</Text>
						</Stack>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>最近一次</CardTitle>
					</CardHeader>
					<CardContent>
						<Stack gap={4}>
							<Stamp value={group.last_seen} />
							<Text size="xs" c="dimmed">
								最近事件决定下面展示的 message
							</Text>
						</Stack>
					</CardContent>
				</Card>
			</SimpleGrid>

			<Card>
				<CardHeader>
					<Group justify="space-between" align="center" wrap="wrap" gap="xs">
						<CardTitle>最近消息</CardTitle>
						<Group gap={6}>
							{group.level && (
								<Badge variant="light" color={group.level === "CRITICAL" ? "red" : "orange"}>
									{group.level}
								</Badge>
							)}
							<Code>{group.logger || "未知来源"}</Code>
						</Group>
					</Group>
				</CardHeader>
				<CardContent>
					<MessageBlock message={group.message} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>消息变体</CardTitle>
				</CardHeader>
				<CardContent>
					{!group.messages || group.messages.length <= 1 ? (
						<Text size="sm" c="dimmed">
							该指纹在当前数据源里只有一条消息
							{group.messages ? "" : "（本快照未提供变体列表，仅透出最近一条）"}。
						</Text>
					) : (
						<Stack gap="sm">
							<Text size="xs" c="dimmed">
								同一指纹下的不同消息（去重、按首次出现顺序、最多 5 条）—— 单一根因线索被覆盖时看这里。
							</Text>
							{group.messages.map((message, index) => (
								<div key={`${index}-${message.slice(0, 24)}`}>
									<Text size="xs" c="dimmed" mb={4}>
										变体 {index + 1}
									</Text>
									<MessageBlock message={message} />
								</div>
							))}
						</Stack>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>可追溯线索</CardTitle>
				</CardHeader>
				<CardContent>
					<Stack gap={8}>
						<Group gap={8} wrap="wrap">
							<Text size="sm" c="dimmed">
								来源
							</Text>
							<Code>{group.source || "未标注（合并视图不含 source）"}</Code>
						</Group>
						<Group gap={8} wrap="wrap">
							<Text size="sm" c="dimmed">
								发生后端版本
							</Text>
							{group.version ? (
								<>
									<Code>{group.version}</Code>
									{/* 版本归因页按产物身份聚合，不按 APP_VERSION 过滤：只给页面入口，不假装是精确过滤 */}
									<Anchor component={Link} to="/admin/versions" size="sm">
										查看版本归因
									</Anchor>
								</>
							) : (
								<Text size="sm" c="dimmed">
									档案事件未记录版本
								</Text>
							)}
						</Group>
						<Text size="xs" c="dimmed">
							档案不含 request_id / 处理人 / 已解决状态，本页因此也不显示它们；
							审计日志与该错误无关联列，不做推测性链接。
						</Text>
					</Stack>
				</CardContent>
			</Card>
		</Stack>
	);
}

function FrontendEvidence({
	group,
	windowLabel,
	lastSeenInWindow,
	windowMinutes,
}: {
	group: FrontendErrorEntry;
	windowLabel: string;
	lastSeenInWindow: boolean;
	windowMinutes: number;
}) {
	return (
		<Stack gap="md">
			{!lastSeenInWindow && (
				<Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />} title="已超出当前窗口">
					<Text size="sm">
						该指纹最近一次上报早于当前窗口（{windowLabel}），已不再出现在运维页列表；此页仍可展示档案里的最后状态。
					</Text>
				</Alert>
			)}

			<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
				<Card>
					<CardHeader>
						<CardTitle>上报次数</CardTitle>
					</CardHeader>
					<CardContent>
						<Stack gap={4}>
							<Text size="xl" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
								{group.count.toLocaleString()}
							</Text>
							<Text size="xs" c="dimmed">
								{windowMinutes} 分钟窗口内累计
							</Text>
						</Stack>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>首次上报</CardTitle>
					</CardHeader>
					<CardContent>
						<Stamp value={group.first_seen} />
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>最近上报</CardTitle>
					</CardHeader>
					<CardContent>
						<Stamp value={group.time} />
					</CardContent>
				</Card>
			</SimpleGrid>

			<Card>
				<CardHeader>
					<Group justify="space-between" align="center" wrap="wrap" gap="xs">
						<CardTitle>错误消息</CardTitle>
						<Group gap={6}>
							{group.type && (
								<Badge variant="light" color="grape">
									{group.type}
								</Badge>
							)}
							{group.source && <Code>{group.source}</Code>}
						</Group>
					</Group>
				</CardHeader>
				<CardContent>
					<MessageBlock message={group.message} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>浏览器现场</CardTitle>
				</CardHeader>
				<CardContent>
					<Stack gap={12}>
						<Group gap={8} align="flex-start" wrap="wrap">
							<Text size="sm" c="dimmed" w={56} style={{ flexShrink: 0 }}>
								URL
							</Text>
							{group.url ? (
								<Code style={{ wordBreak: "break-all" }}>{group.url}</Code>
							) : (
								<Text size="sm" c="dimmed">
									未上报
								</Text>
							)}
						</Group>
						<Group gap={8} align="flex-start" wrap="wrap">
							<Text size="sm" c="dimmed" w={56} style={{ flexShrink: 0 }}>
								UA
							</Text>
							{group.ua ? (
								<Text size="xs" style={{ wordBreak: "break-word" }}>
									{group.ua}
								</Text>
							) : (
								<Text size="sm" c="dimmed">
									未上报（老数据/跨 worker 归档未携带）
								</Text>
							)}
						</Group>
						<Group gap={8} align="flex-start" wrap="wrap">
							<Text size="sm" c="dimmed" w={56} style={{ flexShrink: 0 }}>
								用户
							</Text>
							{group.user_id ? (
								<Text size="sm">用户 #{group.user_id}</Text>
							) : (
								<Text size="sm" c="dimmed">
									未上报
								</Text>
							)}
						</Group>
						<div>
							<Text size="sm" c="dimmed" mb={6}>
								组件栈
							</Text>
							{group.component_stack ? (
								<Code
									block
									style={{
										whiteSpace: "pre-wrap",
										wordBreak: "break-word",
										fontSize: 12,
										lineHeight: 1.6,
										maxHeight: 280,
										overflow: "auto",
									}}
								>
									{group.component_stack}
								</Code>
							) : (
								<Text size="sm" c="dimmed">
									无组件栈（window 级错误或 ErrorBoundary 未捕获树）
								</Text>
							)}
						</div>
						<Text size="xs" c="dimmed">
							UA 用于区分环境问题与代码缺陷：机房/旧浏览器缺内置 API 会稳定复现同一 TypeError，
							只看 message 会误判为代码 bug。
						</Text>
					</Stack>
				</CardContent>
			</Card>
		</Stack>
	);
}

/**
 * 窗口标签 → 分钟数。`errors.window` 可能是 `rolling_60m` 或 `rolling_<N>m`；
 * 认不出时返回 null（页面只说「当前窗口」，不编一个分钟数）。
 */
function windowMinutes(label: string | undefined): number | null {
	const match = /(\d+)\s*m\b/.exec(label ?? "");
	return match ? Number(match[1]) : null;
}

function isWithinWindow(value: string, minutes: number | null): boolean {
	if (!minutes) return true;
	const stamp = Date.parse(value);
	if (Number.isNaN(stamp)) return true;
	return Date.now() - stamp <= minutes * 60_000;
}

export default function OpsErrorDetailPage() {
	const { fingerprint: rawFingerprint } = useParams<{ fingerprint: string }>();
	const fingerprint = normalizeFingerprint(rawFingerprint);

	const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
		queryKey: queryKeys.diagnose,
		queryFn: () => fetchDiagnose().then((r) => r.data),
		enabled: fingerprint !== null,
		staleTime: 15_000,
	});

	const header = (subtitle: string) => (
		<PageHeader
			title="错误组详情"
			subtitle={subtitle}
			icon={IconBug}
			backTo={BACK_TO_OPS}
			actions={
				<Group gap={8}>
					<Button
						variant="subtle"
						size="sm"
						leftSection={<IconArrowLeft size={14} />}
						component={Link}
						to={BACK_TO_OPS}
					>
						返回运维
					</Button>
					<Button
						variant="outline"
						size="sm"
						leftSection={<IconRefresh size={14} />}
						onClick={() => refetch()}
						loading={isRefetching}
						disabled={fingerprint === null}
					>
						刷新
					</Button>
				</Group>
			}
		/>
	);

	if (!fingerprint) {
		return (
			<Stack gap="md">
				{header("地址无效")}
				<ErrorState
					title="错误指纹无效"
					description="地址里的指纹含非法字符或已损坏。请从运维仪表盘的错误列表重新进入。"
				/>
				<Anchor component={Link} to={BACK_TO_OPS} size="sm">
					返回运维仪表盘
				</Anchor>
			</Stack>
		);
	}

	if (isLoading) {
		return (
			<Stack gap="md">
				{header(`指纹 ${fingerprint}`)}
				<LoadingSkeleton variant="card" />
			</Stack>
		);
	}

	// 查询失败与「查不到该指纹」是两件事：不能把失败渲染成「没有这个错误」。
	if (isError || !data) {
		return (
			<Stack gap="md">
				{header(`指纹 ${fingerprint}`)}
				<ErrorState title="诊断数据加载失败" error={error} onRetry={() => refetch()} />
				<Anchor component={Link} to={BACK_TO_OPS} size="sm">
					返回运维仪表盘
				</Anchor>
			</Stack>
		);
	}

	const backendGroup = resolveBackendGroups(data.errors).find(
		(g) => g.fingerprint === fingerprint,
	);
	const frontendGroup = resolveFrontendGroups(data.frontend_errors).find(
		(g) => g.fingerprint === fingerprint,
	);

	const backendWindow = data.errors?.window;
	const frontendWindow = data.frontend_errors?.window;
	const backendMinutes = windowMinutes(backendWindow);
	const frontendMinutes = windowMinutes(frontendWindow) ?? 60;

	const lastSeen = backendGroup
		? backendGroup.last_seen
		: frontendGroup
			? groupLastSeen(frontendGroup)
			: "";
	const inWindow = frontendGroup
		? isWithinWindow(lastSeen, frontendMinutes)
		: backendGroup
			? isWithinWindow(lastSeen, backendMinutes)
			: false;

	const kindLabel = backendGroup ? "后端 system errors" : "前端遥测";
	const subtitle = `${fingerprint} · ${kindLabel}`;

	// 两个块都找不到：要么窗口已滚过，要么不是这一类错误（后端 vs 前端）。
	if (!backendGroup && !frontendGroup) {
		return (
			<Stack gap="md">
				{header(subtitle)}
				<EmptyState
					icon={IconBug}
					title="当前窗口内没有该指纹"
					description={`档案里查不到 ${fingerprint}。可能的原因：该错误组的最近一次发生早于当前窗口（后端 ${backendWindow ?? "当前窗口"} / 前端 ${frontendWindow ?? "当前窗口"}），或指纹不属于本窗口的任一错误组。下拉刷新不会找回已滚出窗口的证据。`}
					action={
						<Group gap={8}>
							<Button variant="light" size="xs" leftSection={<IconRefresh size={14} />} onClick={() => refetch()}>
								重新查询
							</Button>
							<Button variant="subtle" size="xs" component={Link} to={BACK_TO_OPS}>
								返回运维仪表盘
							</Button>
						</Group>
					}
				/>
				<Alert variant="light" color="gray" icon={<IconAlertTriangle size={16} />} title="为什么可能查不到">
					<Text size="sm">
						诊断快照有 120 秒缓存，且档案只保留滚动窗口内的事件。刚发生但尚未落盘的错误可能还没进入本 worker 的快照；
						换一个窗口后再试，或以运维页的实时列表为准。
					</Text>
				</Alert>
			</Stack>
		);
	}

	return (
		<Stack gap="xl">
			{header(subtitle)}

			<Card size="sm">
				<CardContent>
					<Group justify="space-between" align="center" wrap="wrap" gap="sm">
						<Stack gap={2}>
							<Text size="xs" c="dimmed">
								指纹
							</Text>
							<Code style={{ fontSize: 13 }}>{fingerprint}</Code>
						</Stack>
						<Group gap="lg" wrap="wrap">
							<Stack gap={2}>
								<Text size="xs" c="dimmed">
									类型
								</Text>
								<Badge variant="light" color={backendGroup ? "blue" : "grape"}>
									{backendGroup ? "后端 system errors" : "前端遥测"}
								</Badge>
							</Stack>
							<Stack gap={2}>
								<Text size="xs" c="dimmed">
									窗口
								</Text>
								<Text size="sm" ff="monospace">
									{backendGroup ? (backendWindow ?? "当前窗口") : (frontendWindow ?? "当前窗口")}
								</Text>
							</Stack>
							<Stack gap={2}>
								<Text size="xs" c="dimmed">
									最近发生
								</Text>
								<Stamp value={lastSeen} />
							</Stack>
							<Stack gap={2}>
								<Text size="xs" c="dimmed">
									窗口内
								</Text>
								<Group gap={4}>
									{inWindow ? (
										<>
											<IconCircleCheck size={14} color="var(--mantine-color-green-6)" />
											<Text size="sm" c="green">
												是
											</Text>
										</>
									) : (
										<>
											<IconAlertTriangle size={14} color="var(--mantine-color-yellow-6)" />
											<Text size="sm" c="yellow">
												已滚出
											</Text>
										</>
									)}
								</Group>
							</Stack>
						</Group>
					</Group>
				</CardContent>
			</Card>

			{backendGroup && (
				<BackendEvidence
					group={backendGroup}
					windowLabel={backendWindow ?? "当前窗口"}
					currentWindow={backendWindow ?? "当前查询窗口"}
					lastSeenInWindow={isWithinWindow(backendGroup.last_seen, backendMinutes)}
				/>
			)}

			{frontendGroup && (
				<FrontendEvidence
					group={frontendGroup}
					windowLabel={frontendWindow ?? "当前窗口"}
					windowMinutes={frontendMinutes}
					lastSeenInWindow={isWithinWindow(groupLastSeen(frontendGroup), frontendMinutes)}
				/>
			)}

			<Text size="xs" c="dimmed">
				数据来自运维页同一个诊断快照（`/admin/ops/dashboard`），刷新后仍以该快照为准；
				后端错误与前端遥测的指纹算法不同，同一字符串在两边会得到不同指纹，属正常。
			</Text>
		</Stack>
	);
}
