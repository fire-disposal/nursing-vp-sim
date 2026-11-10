import {
	Badge,
	Box,
	Button,
	Group,
	Progress,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import {
	IconAlertTriangle,
	IconArrowRight,
	IconBuildingCommunity,
	IconCoins,
	IconPhoto,
	IconSchool,
	IconUsers,
} from "@tabler/icons-react";
import { isAxiosError } from "axios";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { SchoolItem } from "@/api/admin/schools";
import SchoolQuotaModal from "@/components/admin/SchoolQuotaModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import { useEnterSchoolAdmin } from "@/hooks/useEnterSchoolAdmin";
import { useSchoolDetailQuery } from "@/hooks/useSchools";
import { schoolLogoUrl } from "@/stores/schoolScopeStore";
import { formatDate } from "@/utils/date";

/** 用量条：limit=0 表示不限，此时只报数、不画进度（0 当分母会永远满格）。 */
function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
	const unlimited = limit <= 0;
	const pct = unlimited ? 0 : Math.min(100, (used / limit) * 100);
	const color = pct >= 90 ? "red" : pct >= 70 ? "orange" : "blue";
	return (
		<Stack gap={4}>
			<Group justify="space-between" gap={8} wrap="nowrap">
				<Text size="xs" c="dimmed">
					{label}
				</Text>
				<Text size="xs" className="tabular-nums">
					{used.toFixed(2)}
					{unlimited ? "" : ` / ${limit.toFixed(2)}`}
				</Text>
			</Group>
			{unlimited ? (
				<Text size="xs" c="dimmed">
					不限（未设月度上限）
				</Text>
			) : (
				<Progress value={pct} color={color} size="sm" aria-label={`${label} 用量 ${Math.round(pct)}%`} />
			)}
		</Stack>
	);
}

/**
 * 院校详情（`/admin/schools/:schoolId`，需 `school_manage`）。
 *
 * 列表回答"有哪些学校"，这一页回答"这所学校现在什么状态、我要不要进去管它"：
 * 身份/品牌、管理员/班级/账号计数、用量与额度入口、班级摘要，主行动是「进入管理」——
 * 与列表行同一个 `useEnterSchoolAdmin`（切校 → 切 admin 视角 → 清缓存 → 刷新权限）。
 *
 * 数据不足时**不猜**：计数/额度都来自详情端点；端点不可用就报错并给重试，
 * 不把 403/网络失败渲染成"这所学校为空"。
 */
export default function SchoolDetailPage() {
	const { schoolId } = useParams<{ schoolId: string }>();
	const numericId = Number(schoolId);
	const enterSchoolAdmin = useEnterSchoolAdmin();
	const [quotaOpen, setQuotaOpen] = useState(false);

	const { data, isLoading, isError, error, refetch } = useSchoolDetailQuery(
		Number.isInteger(numericId) && numericId > 0 ? numericId : null,
	);

	// 详情端点与品牌/额度组件共用同一形状（SchoolItem），可直接喂给它们
	const school: SchoolItem | undefined = data;

	if (isLoading) return <LoadingSkeleton variant="stats" />;

	if (isError) {
		// 404 = 越权与不存在共用同一个回答（后端失败关闭），所以文案不区分，
		// 只说"看不到这所院校"；网络/5xx 才是可重试的失败。
		const notFound = isAxiosError(error) && error.response?.status === 404;
		if (notFound) {
			return (
				<EmptyState
					icon={IconAlertTriangle}
					title="院校不存在或无权访问"
					description="该院校可能已被删除，或不在你当前的工作视图内"
					action={
						<Button component={Link} to="/admin/schools" variant="default">
							返回院校管理
						</Button>
					}
				/>
			);
		}
		return (
			<ErrorState
				title="院校详情加载失败"
				error={error}
				onRetry={() => void refetch()}
			/>
		);
	}

	if (!school) {
		return (
			<EmptyState
				icon={IconAlertTriangle}
				title="院校不存在或无权访问"
				description="该院校可能已被删除，或不在你当前的工作视图内"
				action={
					<Button component={Link} to="/admin/schools" variant="default">
						返回院校管理
					</Button>
				}
			/>
		);
	}

	const classes = data?.classes ?? [];
	const classTotal = data?.class_total ?? school.class_count;
	const brandKey = school.theme_color ?? null;

	const enter = () => {
		void enterSchoolAdmin(school);
	};

	return (
		<Stack gap="lg">
			<PageHeader
				title={school.name}
				subtitle={`院校详情 · 建于 ${formatDate(school.created_at)}`}
				icon={IconBuildingCommunity}
				backTo="/admin/schools"
				actions={
					<>
						<Button variant="default" onClick={() => setQuotaOpen(true)} leftSection={<IconCoins size={16} />}>
							额度
						</Button>
						<Button onClick={enter} leftSection={<IconArrowRight size={16} />}>
							进入管理
						</Button>
					</>
				}
			/>

			{/* 品牌：院徽 + 主题色。两者都可选，所以没有院徽时用主题色块占位而不是破图。 */}
			<Card>
				<CardHeader>
					<Group gap={8} align="center">
						<IconPhoto size={18} />
						<CardTitle>品牌</CardTitle>
					</Group>
				</CardHeader>
				<CardContent>
					<Group gap="md" align="center" wrap="wrap">
						<Box
							w={64}
							h={64}
							style={{
								border: "1px solid var(--mantine-color-default-border)",
								borderRadius: 8,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								overflow: "hidden",
								background: "var(--mantine-color-default-hover)",
							}}
						>
							{school.has_logo ? (
								<img
									src={schoolLogoUrl({
										id: school.id,
										logoUpdatedAt: school.logo_updated_at ?? null,
									})}
									alt={`${school.name} 院徽`}
									width={64}
									height={64}
									style={{ maxWidth: "100%", maxHeight: "100%" }}
								/>
							) : (
								<IconPhoto size={24} color="var(--mantine-color-dimmed)" />
							)}
						</Box>
						<Stack gap={4} style={{ minWidth: 0 }}>
							<Group gap={8} wrap="wrap">
								<Text size="sm" fw={600}>
									主题色
								</Text>
								<Badge variant="light" color={brandKey ? "gray" : "brand"}>
									{brandKey ?? "平台默认"}
								</Badge>
								<Badge variant="default">{school.has_logo ? "已上传院徽" : "未上传院徽"}</Badge>
							</Group>
							<Text size="xs" c="dimmed">
								改名、换色与院徽在院校管理的「编辑」里，改动对该校所有账号生效
							</Text>
							<Group gap={8} mt={4} wrap="wrap">
								{/* 深链到列表的同一张编辑弹窗（`?edit=<id>`）：品牌编辑只有一份实现 */}
								<Button
									component={Link}
									to={`/admin/schools?edit=${school.id}`}
									variant="default"
									size="xs"
									leftSection={<IconPhoto size={14} />}
								>
									编辑品牌与院徽
								</Button>
							</Group>
						</Stack>
					</Group>
				</CardContent>
			</Card>

			<SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
				<StatCard icon={IconUsers} value={school.admin_count} label="管理员" color={school.admin_count > 0 ? "blue" : "amber"} />
				<StatCard icon={IconSchool} value={school.class_count} label="班级数" color="green" />
				<StatCard icon={IconUsers} value={school.user_count} label="账号数" color="blue" />
			</SimpleGrid>

			{school.admin_count === 0 && (
				<Group gap={8} align="flex-start" wrap="nowrap">
					<Box c="orange" pt={2}>
						<IconAlertTriangle size={16} />
					</Box>
					<Text size="xs" c="dimmed">
						这所院校还没有管理员：账号与班级目前只能由平台创建。进入管理后可在用户管理里授予院校管理员。
					</Text>
				</Group>
			)}

			<Card>
				<CardHeader>
					<Group justify="space-between" align="center" wrap="wrap" gap={8}>
						<Group gap={8} align="center">
							<IconCoins size={18} />
							<CardTitle>用量与额度</CardTitle>
						</Group>
						<Button variant="subtle" size="xs" onClick={() => setQuotaOpen(true)}>
							调整额度
						</Button>
					</Group>
				</CardHeader>
				<CardContent>
					<Stack gap="md">
						<UsageBar
							label="LLM 本月用量"
							used={data?.llm_used ?? 0}
							limit={data?.llm_monthly_limit ?? 0}
						/>
						<UsageBar
							label="TTS 本月用量"
							used={data?.tts_used ?? 0}
							limit={data?.tts_monthly_limit ?? 0}
						/>
						<Group gap={16} wrap="wrap">
							<Text size="xs" c="dimmed">
								用户默认日额度（LLM）：
								{data?.default_daily_llm_limit == null ? "继承平台默认" : data.default_daily_llm_limit}
							</Text>
							<Text size="xs" c="dimmed">
								用户默认日额度（TTS）：
								{data?.default_daily_tts_limit == null ? "继承平台默认" : data.default_daily_tts_limit}
							</Text>
						</Group>
					</Stack>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<Group gap={8} align="center">
						<IconSchool size={18} />
						<CardTitle>班级</CardTitle>
						<Text size="xs" c="dimmed">
							{classTotal > classes.length ? `显示前 ${classes.length} / 共 ${classTotal} 个` : `共 ${classTotal} 个`}
						</Text>
					</Group>
				</CardHeader>
				<CardContent>
					{classes.length === 0 ? (
						<Text size="sm" c="dimmed" py="sm">
							这所院校还没有班级。进入管理后可创建班级并把账号加进去。
						</Text>
					) : (
						<Stack gap="xs">
							{classes.map((c) => (
								<Group
									key={c.id}
									justify="space-between"
									gap={8}
									wrap="nowrap"
									style={{ minWidth: 0 }}
								>
									{/* 纯文本，不是链接：平台视角（platform）没有 grade_class_manage，
									    指到班级详情只会 403。班级管理在「进入管理」之后的视角里。 */}
									<Text size="sm" truncate>
										{c.name}
									</Text>
									<Group gap={8} wrap="nowrap">
										<Badge variant="light" size="sm">
											{c.cohort_label || "未标届"}
										</Badge>
										<Text size="xs" c="dimmed" className="tabular-nums" style={{ whiteSpace: "nowrap" }}>
											{c.student_count} 学生 · {c.teacher_count} 教师
										</Text>
									</Group>
								</Group>
							))}
						</Stack>
					)}
				</CardContent>
			</Card>

			<SchoolQuotaModal
				school={quotaOpen ? { id: school.id, name: school.name } : null}
				opened={quotaOpen}
				onClose={() => setQuotaOpen(false)}
			/>
		</Stack>
	);
}
