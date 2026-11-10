import {
	IconActivity,
	IconBook2,
	IconBuildingCommunity,
	IconChartBar,
	IconClipboardCheck,
	IconClipboardList,
	IconCoins,
	IconFileSearch,
	IconFileText,
	IconKey,
	IconMessageCircle,
	IconRobot, // lucide `Bot` 无同名 tabler icon，语义等价为机器人
	IconSchool,
	IconShield,
	IconSpeakerphone,
	IconStethoscope,
	IconTrophy,
	IconUser,
	IconUserSearch,
	IconUsers,
	IconVersions,
} from "@tabler/icons-react";
import { type ComponentType, type CSSProperties, lazy, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Permission } from "@/utils/permissions";
import { isPersonaId, type PersonaId } from "@/utils/personas";

const DashboardHome = lazy(() => import("@/pages/share/DashboardHome"));

const TrainingSelect = lazy(() => import("@/pages/practice/TrainingSelect"));
const StudentAssignmentDetailPage = lazy(() => import("@/pages/practice/StudentAssignmentDetailPage"));
const TrainingEntry = lazy(() => import("@/pages/practice/TrainingEntry"));
const History = lazy(() => import("@/pages/practice/History"));
const VersionsPage = lazy(() => import("@/pages/ops/VersionsPage"));
const TeacherRecordDetail = lazy(() => import("@/pages/teaching/TeacherRecordDetail"));
const ReviewWorkbench = lazy(() => import("@/pages/teaching/ReviewWorkbench"));
const RecordDetail = lazy(() => import("@/pages/practice/RecordDetail"));
const QA = lazy(() => import("@/pages/practice/QA"));
const AdminSecrets = lazy(() => import("@/pages/ops/SecretsPage"));
const MyFeedbackPage = lazy(() => import("@/pages/share/MyFeedback"));
const NotificationInboxPage = lazy(() => import("@/pages/share/NotificationInboxPage"));
const Profile = lazy(() => import("@/pages/share/Profile"));
const Admin = lazy(() => import("@/pages/teaching/home/Home"));
const AdminUsers = lazy(() => import("@/pages/people/UsersPage"));
const UserImportPage = lazy(() => import("@/pages/people/UserImportPage"));
const AdminUserDetail = lazy(() => import("@/pages/people/UserDetailPage"));
const AdminPersonas = lazy(() => import("@/pages/people/PersonasPage"));
const AdminClasses = lazy(
	() => import("@/pages/people/ClassesPage"),
);
const AdminSchools = lazy(() => import("@/pages/people/SchoolsPage"));
const SchoolDetailPage = lazy(() => import("@/pages/people/SchoolDetailPage"));
const PlatformOverview = lazy(() => import("@/pages/ops/PlatformOverviewPage"));
const AdminCases = lazy(() => import("@/pages/content/CasesPage"));
const CaseWorkspacePage = lazy(() => import("@/pages/content/CaseWorkspacePage"));
const AssignmentsPage = lazy(
	() => import("@/pages/teaching/AssignmentsPage"),
);
const AssignmentDetailPage = lazy(
	() => import("@/pages/teaching/AssignmentDetailPage"),
);
const ScoreboardPage = lazy(() => import("@/pages/teaching/ScoreboardPage"));
const StudentLearningProfilePage = lazy(() => import("@/pages/teaching/StudentLearningProfilePage"));
const CostManagement = lazy(() => import("@/pages/ops/CostManagementPage"));
const AdminFeedback = lazy(() => import("@/pages/ops/FeedbackPage"));
const ClassDetailPage = lazy(() => import("@/pages/people/ClassDetailPage"));
const SystemOpsPage = lazy(() => import("@/pages/ops/SystemOpsPage"));
const OpsErrorDetailPage = lazy(() => import("@/pages/ops/OpsErrorDetailPage"));
const SystemNotificationsPage = lazy(
	() => import("@/pages/ops/SystemNotificationsPage"),
);
const AuditLogsPage = lazy(() => import("@/pages/ops/AuditLogsPage"));
const TeacherRecordsPage = lazy(
	() => import("@/pages/teaching/TeacherRecordsPage"),
);
const RubricPage = lazy(() => import("@/pages/content/RubricPage"));
const AdminQuestionnaires = lazy(
	() => import("@/pages/content/AdminQuestionnaires"),
);
const QuestionnaireStatsPage = lazy(() => import("@/pages/content/QuestionnaireStatsPage"));
const QuestionnaireResponsesPage = lazy(() => import("@/pages/content/QuestionnaireResponsesPage"));
const QuestionnaireResponseDetailPage = lazy(() => import("@/pages/content/QuestionnaireResponseDetailPage"));
/**
 * 当前的「活动」——决定**外壳形态**（`AdaptiveShell` 按它选壳）。
 *
 * 只有两个值，因为只有两种壳：沉浸会话（练习）与常规应用壳（浏览、配置、审阅都在其中）。
 * 2026-09-30 审计删掉了从没有生产者的 `"review"`：声明了三态却 31 条路由都是 `manage`，
 * 唯一的分支只有 `practice`——留着它只会让人以为存在第三种壳。
 */
export type Activity = "practice" | "manage";

export type NavSection = "user" | "admin";

export type NavGroupKey = "personal" | "teaching" | "content" | "people" | "system";

export type NavIcon = ComponentType<{
	size?: number;
	className?: string;
	stroke?: number;
	color?: string;
	style?: CSSProperties;
}>;

export interface NavGroupDef {
	key: NavGroupKey;
	label: string;
	icon: NavIcon;
	defaultOpen: boolean;
	/** 哪些视角看得到本分组（与条目级 `nav.personas` 覆盖合并，见 `filterNavByPersona`）。 */
	personas: PersonaId[];
}

export const NAV_GROUPS: NavGroupDef[] = [
	// 我的训练：所有视角都保留自己的训练入口（管理/运维也要能练，训练档案是自己的）
	{ key: "personal", label: "我的训练", icon: IconStethoscope, defaultOpen: false, personas: ["student"] },
	// 教学 = 日常查看与操作（看板/作业/成绩/记录）；教学资源 = 低频配置（病例/问卷/标准）
	{ key: "teaching", label: "教学", icon: IconSchool, defaultOpen: true, personas: ["teacher", "admin"] },
	{ key: "content", label: "教学资源", icon: IconBook2, defaultOpen: false, personas: ["teacher", "admin", "platform"] },
	{ key: "people", label: "人员", icon: IconUsers, defaultOpen: false, personas: ["teacher", "admin", "platform"] },
	{ key: "system", label: "运维", icon: IconActivity, defaultOpen: false, personas: ["admin", "ops", "platform"] },
];

/**
 * 移动端底部导航条目（**唯一来源**：底部 Tab 由本字段派生，不再另维护一份清单）。
 *
 * - `tier`：学生轨与教师轨各自一组 Tab（教师的日常是"看板/待批阅/作业"，与学生的
 *   "训练/记录/问答"不是同一组，硬塞在一起会同时得罪两边）；两轨互不混排。
 * - `to`：需要在 Tab 上落一个带筛选的入口时覆盖路由地址（如"待批阅"→ 待复核筛选）。
 */
export interface MobileTab {
	order: number;
	tier: "student" | "staff";
	to?: string;
	label?: string;
	/** 除自身路径外还算"高亮"的其他路径前缀（如记录详情仍高亮"记录"）。 */
	activeOn?: string[];
}

export interface NavMeta {
	label: string;
	icon: NavIcon;
	section: NavSection;
	group?: NavGroupKey;
	end?: boolean;
	mobile?: MobileTab;
	/** 条目级视角覆盖：给出时**取代**所在分组的视角集合（用于分组口径之外的单点例外，
	 *  如「系统反馈」运维/教学/管理都该看到，而不是只有运维）。不给则跟随分组。 */
	personas?: PersonaId[];
	/** 只在路由/移动端 Tab 中出现，不占桌面侧栏（如「我的」从头像进入）。 */
	hideInSidebar?: boolean;
}


export interface AppRoute {
	path: string;
	element: ReactNode;
	permission?: Permission;
	activity: Activity;
	nav?: NavMeta;
}

export const APP_ROUTES: AppRoute[] = [
	// ── User area ──
	// /home retained for admin redirect; not in student nav.
	{ path: "/home", element: <DashboardHome />, activity: "manage" },
	{
		path: "/training",
		element: <TrainingSelect />,
		permission: "training_access",
		activity: "manage",
		nav: {
			label: "训练",
			icon: IconStethoscope,
			section: "user",
			group: "personal",
			mobile: { order: 10, tier: "student" },
		},
	},
	{
		path: "/training/:recordId",
		element: <TrainingEntry />,
		permission: "training_access",
		activity: "practice",
	},
	{
		path: "/cases",
		element: <TrainingSelect tab="self" />,
		permission: "training_access",
		activity: "manage",
		nav: {
			label: "病例",
			icon: IconBook2,
			section: "user",
			group: "personal",
		},
	},
	{
		path: "/assignments",
		element: <TrainingSelect tab="assignments" />,
		permission: "training_access",
		activity: "manage",
		nav: {
			label: "作业",
			icon: IconClipboardList,
			section: "user",
			group: "personal",
			mobile: { order: 20, tier: "student" },
		},
	},
	{
		path: "/assignments/:id",
		element: <StudentAssignmentDetailPage />,
		permission: "training_access",
		activity: "manage",
	},
	{
		path: "/history",
		element: <History />,
		// 记录是"我的训练档案"：没有训练权限的视角（平台/运维）不该在侧栏看到它，
		// 否则入口存在、点进去只有空档案，还会成为落地页候选。
		permission: "training_access",
		activity: "manage",
		nav: {
			label: "记录",
			icon: IconClipboardList,
			section: "user",
			group: "personal",
			mobile: { order: 30, tier: "student", activeOn: ["/record"] },
		},
	},
	// Sub-pages under 记录 — not primary nav items.
	{ path: "/record/:id", element: <RecordDetail />, activity: "manage" },
	// 训练统计页已并入教学看板（趋势图与 per-student 训练量都搬过去了）——保留旧地址重定向，
	// 否则收藏/旧文档里的 /admin/stats 会被兜底路由弹到登录页。
	{ path: "/admin/stats", element: <Navigate to="/admin" replace />, activity: "manage" },
	// Sub-pages under 我的 — not primary nav items.
	{ path: "/my-feedback", element: <MyFeedbackPage />, activity: "manage" },
	{ path: "/notifications", element: <NotificationInboxPage />, activity: "manage" },
	// QA — AI 护理导师，学生端独立 Tab。
	{ path: "/qa", element: <QA />, permission: "qa_access", activity: "manage", nav: { label: "问答", icon: IconRobot, section: "user", group: "personal", mobile: { order: 40, tier: "student" } } },
	{
		path: "/profile",
		element: <Profile />,
		activity: "manage",
		nav: {
			label: "我的",
			icon: IconUser,
			section: "user",
			hideInSidebar: true,
			// 通知与「我的反馈」都从「我的」进入（三者同一子 tab 栏），底部 Tab 高亮跟着走
			mobile: { order: 50, tier: "student", activeOn: ["/notifications", "/my-feedback"] },
		},
	},
	// ── Admin area ──
	{
		path: "/admin/users",
		element: <AdminUsers />,
		permission: "user_manage",
		activity: "manage",
		nav: { label: "用户管理", icon: IconUsers, section: "admin", group: "people" },
	},
	{
		path: "/admin/users/import",
		element: <UserImportPage />,
		permission: "user_manage",
		activity: "manage",
	},
	{
		path: "/admin/users/:userId",
		element: <AdminUserDetail />,
		permission: "user_manage",
		activity: "manage",
	},
	{
		path: "/admin/personas",
		element: <AdminPersonas />,
		permission: "role_manage",
		activity: "manage",
		nav: { label: "视角管理", icon: IconShield, section: "admin", group: "people" },
	},
	{
		path: "/admin/schools",
		element: <AdminSchools />,
		permission: "school_manage",
		activity: "manage",
		nav: { label: "院校管理", icon: IconBuildingCommunity, section: "admin", group: "people" },
	},
	{
		path: "/admin/schools/:schoolId",
		element: <SchoolDetailPage />,
		permission: "school_manage",
		activity: "manage",
	},
	{
		path: "/admin/classes",
		element: <AdminClasses />,
		permission: "grade_class_manage",
		activity: "manage",
		nav: { label: "班级管理", icon: IconSchool, section: "admin", group: "people" },
	},
	{
		path: "/admin/cases",
		element: <AdminCases />,
		permission: "case_manage",
		activity: "manage",
		nav: { label: "病例库", icon: IconUserSearch, section: "admin", group: "content" },
	},
	{
		path: "/admin/cases/new",
		element: <CaseWorkspacePage />,
		permission: "case_manage",
		activity: "manage",
	},
	{
		path: "/admin/cases/:caseId",
		element: <CaseWorkspacePage />,
		permission: "case_manage",
		activity: "manage",
	},
	{
		path: "/admin/assignments",
		element: <AssignmentsPage />,
		permission: "assignment_manage",
		activity: "manage",
		nav: { label: "作业管理", icon: IconClipboardList, section: "admin", group: "teaching", mobile: { order: 30, tier: "staff" } },
	},
	{
		path: "/admin/assignments/:id",
		element: <AssignmentDetailPage />,
		permission: "assignment_manage",
		activity: "manage",
	},
	{
		path: "/admin/students/:userId",
		element: <StudentLearningProfilePage />,
		permission: "assignment_manage",
		activity: "manage",
	},
	{
		path: "/admin/scoreboard",
		element: <ScoreboardPage />,
		permission: "assignment_manage",
		activity: "manage",
		nav: {
			label: "成绩管理",
			icon: IconTrophy,
			section: "admin",
			group: "teaching",
		},
	},
	{
		path: "/admin/classes/:classId",
		element: <ClassDetailPage />,
		permission: "grade_class_manage",
		activity: "manage",
	},
	{
		path: "/admin",
		element: <Admin />,
		// 看板数据来自 /api/stats/*（trends/teacher-summary）与 /api/training/records/summary，
		// 前者要求 stats_view → 导航门禁必须与之一致，否则"只有 score_review"的角色能进页面但统计区 403
		// （2026-09-26 审计 RB-5）
		permission: "stats_view",
		activity: "manage",
		nav: { label: "教学看板", icon: IconChartBar, section: "admin", group: "teaching", end: true, mobile: { order: 10, tier: "staff" } },
	},
	{
		path: "/admin/platform",
		element: <PlatformOverview />,
		permission: "school_manage",
		activity: "manage",
		nav: {
			label: "平台总览",
			icon: IconBuildingCommunity,
			section: "admin",
			group: "system",
			personas: ["platform"],
		},
	},
	{
		path: "/admin/system-ops",
		element: <SystemOpsPage />,
		permission: "api_manage",
		activity: "manage",
		nav: { label: "运维仪表盘", icon: IconActivity, section: "admin", group: "system" },
	},
	{
		path: "/admin/system-ops/errors/:fingerprint",
		element: <OpsErrorDetailPage />,
		permission: "api_manage",
		activity: "manage",
	},
	{
		path: "/admin/versions",
		element: <VersionsPage />,
		permission: "api_manage",
		activity: "manage",
		nav: { label: "版本归因", icon: IconVersions, section: "admin", group: "system" },
	},
	{
		path: "/admin/records",
		element: <TeacherRecordsPage />,
		permission: "score_review",
		activity: "manage",
		// 手机端第一生产力是"批阅"：Tab 直接落到待复核筛选（该筛选此前静默失效，已修）
		nav: { label: "训练记录", icon: IconFileText, section: "admin", group: "teaching", mobile: { order: 20, tier: "staff", to: "/admin/records?review_status=pending", label: "待批阅" } },
	},
	{
		path: "/admin/records/:id",
		element: <TeacherRecordDetail />,
		permission: "score_review",
		activity: "manage",
	},
	{
		path: "/admin/review",
		element: <ReviewWorkbench />,
		permission: "score_review",
		activity: "manage",
		nav: {
			label: "批改工作台",
			icon: IconClipboardCheck,
			section: "admin",
			group: "teaching",
			mobile: { order: 25, tier: "staff" },
		},
	},
	{
		path: "/admin/questionnaires",
		element: <AdminQuestionnaires />,
		permission: "questionnaire_manage",
		activity: "manage",
		nav: {
			label: "问卷管理",
			icon: IconClipboardList,
			section: "admin",
			group: "content",
		},
	},
	{
		path: "/admin/questionnaires/:id/stats",
		element: <QuestionnaireStatsPage />,
		permission: "questionnaire_manage",
		activity: "manage",
	},
	{
		path: "/admin/questionnaires/:id/responses",
		element: <QuestionnaireResponsesPage />,
		permission: "questionnaire_manage",
		activity: "manage",
	},
	{
		path: "/admin/questionnaires/:id/responses/:responseId",
		element: <QuestionnaireResponseDetailPage />,
		permission: "questionnaire_manage",
		activity: "manage",
	},
	{
		path: "/admin/rubric",
		element: <RubricPage />,
		permission: "score_review",
		activity: "manage",
		nav: { label: "评分标准", icon: IconBook2, section: "admin", group: "content" },
	},
	{
		path: "/admin/costs",
		element: <CostManagement />,
		permission: "llm_monitor",
		activity: "manage",
		nav: { label: "成本管理", icon: IconCoins, section: "admin", group: "system" },
	},
	{
		path: "/admin/system-notifications",
		element: <SystemNotificationsPage />,
		permission: "api_manage",
		activity: "manage",
		nav: { label: "系统通知", icon: IconSpeakerphone, section: "admin", group: "system" },
	},
	{
		path: "/admin/secrets",
		element: <AdminSecrets />,
		// 凭据管理从「成本管理」的页签里搬出来：管密钥的人该在运维组看到它，
		// 而不是藏在一个叫"成本"的标题下。权限保持 llm_monitor —— **能进的人与搬迁前完全一致**。
		permission: "llm_monitor",
		activity: "manage",
		nav: { label: "API 密钥", icon: IconKey, section: "admin", group: "system" },
	},
	{
		path: "/admin/audit-logs",
		element: <AuditLogsPage />,
		permission: "audit_view",
		activity: "manage",
		nav: { label: "审计日志", icon: IconFileSearch, section: "admin", group: "system" },
	},
	{
		path: "/admin/feedback",
		element: <AdminFeedback />,
		permission: "feedback_review",
		activity: "manage",
		// 维护者口径：这类反馈**针对系统本身**（bug/建议/评分与内容错误）→ 归运维，
		// 标签用"系统反馈"以消除"是否指教学反馈"的歧义
		nav: {
			label: "系统反馈",
			icon: IconMessageCircle,
			section: "admin",
			group: "system",
			// 教学/管理也会收到针对系统的反馈（评分口径、内容错误），不该只有运维能处理；
			// 权限门仍是 `feedback_review`，这里只放开"哪些视角在导航里看得到"
			personas: ["teacher", "admin", "ops", "platform"],
		},
	},
];

export interface NavItem extends NavMeta {
	to: string;
	permission?: Permission;
}

/**
 * 侧栏/落地页的**工作流顺序**（组内）。
 *
 * 路由声明顺序是代码组织顺序，不该直接变成操作顺序：教师的日常是"看板 → 待批阅 →
 * 批改 → 作业/成绩"，管理员的日常是"用户/班级 → 授予"，配置类（病例/问卷/标准）与
 * 运维类（密钥/版本）靠后。分组本身仍由 `NAV_GROUPS` 决定。
 */
const WORKFLOW_ORDER: Record<string, number> = {
	// 教学：先看当天，再处理待批阅，然后才是发布与成绩
	"/admin": 10,
	"/admin/records": 20,
	"/admin/review": 30,
	"/admin/assignments": 40,
	"/admin/scoreboard": 50,
	// 教学资源：内容 > 低频配置
	"/admin/cases": 10,
	"/admin/questionnaires": 30,
	"/admin/rubric": 40,
	// 人员：账号与班级是日常，授予与院校是管理动作
	"/admin/users": 10,
	"/admin/classes": 20,
	"/admin/personas": 30,
	"/admin/schools": 40,
	// 运维：仪表盘 > 成本 > 审计 > 通知 > 密钥 > 版本 > 反馈
	"/admin/system-ops": 10,
	"/admin/costs": 20,
	"/admin/audit-logs": 30,
	"/admin/system-notifications": 40,
	"/admin/secrets": 50,
	"/admin/versions": 60,
	"/admin/feedback": 70,
};

const GROUP_RANK = new Map<string, number>(
	NAV_GROUPS.map((group, index) => [group.key, index]),
);

function navWorkflowRank(item: NavItem): number {
	if (item.section === "user") return 0;
	const group = GROUP_RANK.get(item.group ?? "") ?? 99;
	return 1000 + group * 100 + (WORKFLOW_ORDER[item.to] ?? 99);
}

export const NAV_ITEMS: NavItem[] = APP_ROUTES.filter(
	(r): r is AppRoute & { nav: NavMeta } => !!r.nav,
)
	.map((r) => ({ to: r.path, ...r.nav, permission: r.permission }))
	// 稳定排序：个人区保持声明顺序，管理区分组内按工作流顺序。
	.sort((a, b) => navWorkflowRank(a) - navWorkflowRank(b));

/**
 * 按**当前视角**过滤导航条目（只管"这一档视角该不该看到这个入口"，不判权限）。
 *
 * 判定顺序：
 * 1. 条目级 `personas` 覆盖优先（如「系统反馈」）；
 * 2. 否则看所在分组 `NAV_GROUPS[].personas`；
 * 3. 无分组（`section: "user"` 的散条目）且无覆盖 → 对所有视角可见。
 *
 * 纯裁剪：不新增、不重排、不改写条目（返回的是输入里那些对象本身）。侧栏按
 * `group` 做分隔线分区，却不在这里给条目补 `group`。
 *
 * `persona` 为空（旧后端没有 personas 字段 / 会话未落定）时**原样返回**：不能因为不认识
 * 视角就把整个侧栏清空。未知取值（legacy 自定义角色名会被后端当作 persona 回传）同理——
 * 拿不到这一档的规则就不做臆测，整份导航交给权限门裁决。
 */
export function filterNavByPersona(items: NavItem[], persona: string | null | undefined): NavItem[] {
	if (!persona || !isPersonaId(persona)) return items;
	return items.filter((item) => {
		const allowed: readonly string[] | undefined =
			item.personas ?? (item.group ? NAV_GROUPS.find((g) => g.key === item.group)?.personas : undefined);
		if (!allowed) return true;
		return allowed.includes(persona);
	});
}

/**
 * 当前会话的落地页：**第一个真正进得去的入口**。
 *
 * `/admin` 要 `stats_view`，而平台/运维视角没有这个键 —— 旧逻辑按"有非学生权限就是管理员"
 * 直接跳 `/admin`，这两类账号一登录就是 403。顺序口径：
 * 1. 平台 → 平台总览（跨院校规模、运行状态与成本）；
 * 2. 有 `stats_view` → 教学看板（管理员/教师的日常首页）；
 * 3. 否则取导航里第一个有权限的管理条目（运维 → 运维仪表盘）；
 * 4. 没有管理条目 → 第一个个人条目（学生 → 训练）；
 * 5. 什么都没有 → 个人中心（永远可达，不制造 403 循环）。
 */
export function resolveLandingPath(
	permissions: readonly string[],
	persona: string | null | undefined,
): string {
	if (persona === "platform") return "/admin/platform";
	const allowed = filterNavByPersona(NAV_ITEMS, persona).filter(
		(item) => !item.permission || permissions.includes(item.permission),
	);
	if (permissions.includes("stats_view") && allowed.some((item) => item.to === "/admin")) {
		return "/admin";
	}
	const adminLanding = allowed.find((item) => item.section === "admin");
	if (adminLanding) return adminLanding.to;
	const userLanding = allowed.find((item) => item.section === "user" && item.to !== "/profile");
	return userLanding?.to ?? "/profile";
}
