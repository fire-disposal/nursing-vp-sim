import {
	IconActivity,
	IconBook2,
	IconChartBar,
	IconClipboardList,
	IconCoins,
	IconFileSearch,
	IconFileText,
	IconKey,
	IconMessageCircle,
	IconRobot, // lucide `Bot` 无同名 tabler icon，语义等价为机器人
	IconSchool,
	IconShield,
	IconSitemap,
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

const DashboardHome = lazy(() => import("@/pages/DashboardHome"));

const TrainingSelect = lazy(() => import("@/pages/TrainingSelect"));
const TrainingEntry = lazy(() => import("@/pages/TrainingEntry"));
const History = lazy(() => import("@/pages/History"));
const VersionsPage = lazy(() => import("@/pages/admin/VersionsPage"));
const TeacherRecordDetail = lazy(() => import("@/pages/admin/TeacherRecordDetail"));
const RecordDetail = lazy(() => import("@/pages/RecordDetail"));
const QA = lazy(() => import("@/pages/QA"));
const AdminSecrets = lazy(() => import("@/pages/admin/SecretsPage"));
const MyFeedbackPage = lazy(() => import("@/pages/MyFeedback"));
const NotificationInboxPage = lazy(() => import("@/pages/NotificationInboxPage"));
const Profile = lazy(() => import("@/pages/Profile"));
const Admin = lazy(() => import("@/pages/Admin"));
const AdminUsers = lazy(() => import("@/pages/admin/UsersPage"));
const AdminUserDetail = lazy(() => import("@/pages/admin/UserDetailPage"));
const AdminRoles = lazy(() => import("@/pages/admin/RolesPage"));
const AdminClasses = lazy(
	() => import("@/pages/admin/ClassesPage"),
);
const AdminCases = lazy(() => import("@/pages/admin/CasesPage"));
const AssignmentsPage = lazy(
	() => import("@/pages/admin/AssignmentsPage"),
);
const AssignmentDetailPage = lazy(
	() => import("@/pages/admin/AssignmentDetailPage"),
);
const ScoreboardPage = lazy(() => import("@/pages/admin/ScoreboardPage"));
const CostManagement = lazy(() => import("@/pages/admin/CostManagementPage"));
const AdminFeedback = lazy(() => import("@/pages/admin/FeedbackPage"));
const ClassDetailPage = lazy(() => import("@/pages/admin/ClassDetailPage"));
const SystemOpsPage = lazy(() => import("@/pages/admin/SystemOpsPage"));
const SystemNotificationsPage = lazy(
	() => import("@/pages/admin/SystemNotificationsPage"),
);
const AuditLogsPage = lazy(() => import("@/pages/admin/AuditLogsPage"));
const TeacherRecordsPage = lazy(
	() => import("@/pages/admin/TeacherRecordsPage"),
);
const RubricPage = lazy(() => import("@/pages/admin/RubricPage"));
const AdminQuestionnaires = lazy(
	() => import("@/pages/admin/AdminQuestionnaires"),
);
// 情境训练：深色场景控制台，学生侧入口 /scenario（2026-09-27 转正式特性后进导航）
const ScenarioConsole = lazy(() => import("@/scenario/ScenarioConsole"));
// 情境训练 · 管理侧：入口 /scenario-admin（导航条目要 case_manage；权限在页面内按块判：
// 内容 case_manage / 数据 stats_view）
const ScenarioAdminPage = lazy(() => import("@/scenario/admin/ScenarioAdminPage"));

/**
 * 当前的「活动」——决定**外壳形态**（`AdaptiveShell` 按它选壳）。
 *
 * 只有两个值，因为只有两种壳：沉浸会话（练习/情境）与常规应用壳（浏览、配置、审阅都在其中）。
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
}

export const NAV_GROUPS: NavGroupDef[] = [
	{ key: "personal", label: "我的训练", icon: IconStethoscope, defaultOpen: false },
	// 教学 = 日常查看与操作（看板/作业/成绩/记录）；教学资源 = 低频配置（病例/问卷/标准）
	{ key: "teaching", label: "教学", icon: IconSchool, defaultOpen: true },
	{ key: "content", label: "教学资源", icon: IconBook2, defaultOpen: false },
	{ key: "people", label: "人员", icon: IconUsers, defaultOpen: false },
	{ key: "system", label: "运维", icon: IconActivity, defaultOpen: false },
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
	/** 条目级权限门：用于"路由级不能判权限、但导航要有门"的页面（如 `/scenario-admin`
	 *  需要 `case_manage` 与 `stats_view` 两个键，路由级只判一个会误挡另一半人）。
	 *  与路由级 `permission` 二选一；两者都给时**条目级优先**。 */
	permission?: Permission;
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
			mobile: { order: 10, tier: "student" },
		},
	},
	{
		path: "/training/:recordId",
		element: <TrainingEntry />,
		permission: "training_access",
		activity: "practice",
	},
	// 情境训练（docs/scenario.md）：与正式训练资源隔离的实验轨，转公开测试后给学生可见入口——
	// 持有 `scenario_training` 的学生在侧栏/底部 Tab 看到「情境」；后端开关关闭时后端 404、入口照旧存在。
	{
		path: "/scenario",
		element: <ScenarioConsole />,
		permission: "scenario_training",
		// **App 导航壳照常**（桌面侧栏 + 移动端底部 Tab 的「情境」）：沉浸只体现在**场景内部**
		// （舞台 / 对话 / 输入这一块），不是把全站导航拿掉——2026-09-28 反馈：手机上没了底部 Tab，
		// 学生既切不回训练/记录，观感也格格不入。控制台因此不再自带返回，出口交给 App 导航。
		activity: "manage",
		nav: { label: "情境", icon: IconSitemap, section: "user", mobile: { order: 20, tier: "student" } },
	},
	{
		path: "/history",
		element: <History />,
		activity: "manage",
		nav: {
			label: "记录",
			icon: IconClipboardList,
			section: "user",
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
	{ path: "/qa", element: <QA />, permission: "qa_access", activity: "manage", nav: { label: "问答", icon: IconRobot, section: "user", mobile: { order: 40, tier: "student" } } },
	{
		path: "/profile",
		element: <Profile />,
		activity: "manage",
		nav: {
			label: "我的",
			icon: IconUser,
			section: "user",
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
		path: "/admin/users/:userId",
		element: <AdminUserDetail />,
		permission: "user_manage",
		activity: "manage",
	},
	{
		path: "/admin/roles",
		element: <AdminRoles />,
		permission: "role_manage",
		activity: "manage",
		nav: { label: "角色管理", icon: IconShield, section: "admin", group: "people" },
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
	// 情境训练管理侧：**路由级不判权限**（本页需要两个键：内容 case_manage / 数据 stats_view，
	// 路由级只判一个会让另一半权限的人被误挡；页面内按块判并渲染 403）。
	// 导航条目用**条目级** `nav.permission`（内容管理者可见），不动路由级口径。
	{
		path: "/scenario-admin",
		element: <ScenarioAdminPage />,
		activity: "manage",
		nav: {
			label: "情境管理",
			icon: IconSitemap,
			section: "admin",
			group: "content",
			permission: "case_manage",
		},
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
		path: "/admin/system-ops",
		element: <SystemOpsPage />,
		permission: "api_manage",
		activity: "manage",
		nav: { label: "运维仪表盘", icon: IconActivity, section: "admin", group: "system" },
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
		nav: { label: "系统反馈", icon: IconMessageCircle, section: "admin", group: "system" },
	},
];

export interface NavItem extends NavMeta {
	to: string;
	permission?: Permission;
}

export const NAV_ITEMS: NavItem[] = APP_ROUTES.filter(
	(r): r is AppRoute & { nav: NavMeta } => !!r.nav,
).map((r) => ({ to: r.path, ...r.nav, permission: r.nav.permission ?? r.permission }));
