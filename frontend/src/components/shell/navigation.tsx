import {
	Activity as ActivityIcon,
	BarChart3,
	BookOpen,
	ClipboardCheck,
	ClipboardList,
	Coins,
	FileText,
	GraduationCap,
	type LucideIcon,
	Megaphone,
	MessageSquare,
	Shield,
	Stethoscope,
	User,
	UserSearch,
	Users,
} from "lucide-react";
import { lazy, type ReactNode } from "react";
import type { Permission } from "@/utils/permissions";

const DashboardHome = lazy(() => import("@/pages/DashboardHome"));

const TrainingSelect = lazy(() => import("@/pages/TrainingSelect"));
const TrainingEntry = lazy(() => import("@/pages/TrainingEntry"));
const History = lazy(() => import("@/pages/History"));
const TeacherRecordDetail = lazy(() => import("@/pages/admin/TeacherRecordDetail"));
const RecordDetail = lazy(() => import("@/pages/RecordDetail"));
const QA = lazy(() => import("@/pages/QA"));
const StatsPage = lazy(() => import("@/pages/admin/StatsPage"));
const MyStatsPage = lazy(() => import("@/pages/MyStatsPage"));
const MyResponses = lazy(() => import("@/pages/MyResponses"));
const MyFeedbackPage = lazy(() => import("@/pages/MyFeedback"));
const NotificationInboxPage = lazy(() => import("@/pages/NotificationInboxPage"));
const Profile = lazy(() => import("@/pages/Profile"));
const Admin = lazy(() => import("@/pages/Admin"));
const AdminUsers = lazy(() => import("@/pages/admin/UsersPage"));
const AdminUserDetail = lazy(() => import("@/pages/admin/UserDetailPage"));
const AdminRoles = lazy(() => import("@/pages/admin/RolesPage"));
const AdminGradesClasses = lazy(
	() => import("@/pages/admin/GradesClassesPage"),
);
const AdminCases = lazy(() => import("@/pages/admin/CasesPage"));
const AssignmentsPage = lazy(
	() => import("@/pages/admin/AssignmentsPage"),
);
const AssignmentDetailPage = lazy(
	() => import("@/pages/admin/AssignmentDetailPage"),
);
const CostManagement = lazy(() => import("@/pages/admin/CostManagementPage"));
const AdminFeedback = lazy(() => import("@/pages/admin/FeedbackPage"));
const ClassDetailPage = lazy(() => import("@/pages/admin/ClassDetailPage"));
const SystemOpsPage = lazy(() => import("@/pages/admin/SystemOpsPage"));
const SystemNotificationsPage = lazy(
	() => import("@/pages/admin/SystemNotificationsPage"),
);
const TeacherRecordsPage = lazy(
	() => import("@/pages/admin/TeacherRecordsPage"),
);
const RubricPage = lazy(() => import("@/pages/admin/RubricPage"));

export type Activity = "practice" | "review" | "manage";

export type NavSection = "user" | "admin";

export type NavGroupKey = "teaching" | "people" | "system";

export interface NavGroupDef {
	key: NavGroupKey;
	label: string;
	icon: LucideIcon;
	defaultOpen: boolean;
}

export const NAV_GROUPS: NavGroupDef[] = [
	{ key: "teaching", label: "教学", icon: GraduationCap, defaultOpen: true },
	{ key: "people", label: "人员", icon: Users, defaultOpen: false },
	{ key: "system", label: "系统", icon: ActivityIcon, defaultOpen: false },
];

export interface NavMeta {
	label: string;
	shortLabel?: string;
	icon: LucideIcon;
	section: NavSection;
	group?: NavGroupKey;
	end?: boolean;
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
			icon: Stethoscope,
			section: "user",
		},
	},
	{
		path: "/training/:recordId",
		element: <TrainingEntry />,
		permission: "training_access",
		activity: "practice",
	},
	{
		path: "/history",
		element: <History />,
		activity: "manage",
		nav: {
			label: "记录",
			icon: ClipboardList,
			section: "user",
		},
	},
	// Sub-pages under 记录 — not primary nav items.
	{ path: "/record/:id", element: <RecordDetail />, activity: "manage" },
	{ path: "/my-stats", element: <MyStatsPage />, activity: "manage" },
	{ path: "/admin/stats", element: <StatsPage />, permission: "stats_view", activity: "manage" },
	{ path: "/my-feedback", element: <MyFeedbackPage />, activity: "manage" },
	// Sub-pages under 我的 — not primary nav items.
	{ path: "/notifications", element: <NotificationInboxPage />, activity: "manage" },
	// QA — accessible via profile quick link, not primary nav.
	{ path: "/qa", element: <QA />, permission: "qa_access", activity: "manage" },
	{
		path: "/profile",
		element: <Profile />,
		activity: "manage",
		nav: {
			label: "我的",
			icon: User,
			section: "user",
		},
	},

	// ── Admin area ──
	{
		path: "/admin/users",
		element: <AdminUsers />,
		permission: "user_manage",
		activity: "manage",
		nav: { label: "用户管理", icon: Users, section: "admin", group: "people" },
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
		nav: { label: "角色管理", icon: Shield, section: "admin", group: "people" },
	},
	{
		path: "/admin/grades-classes",
		element: <AdminGradesClasses />,
		permission: "grade_class_manage",
		activity: "manage",
		nav: { label: "班级管理", icon: GraduationCap, section: "admin", group: "people" },
	},
	{
		path: "/admin/cases",
		element: <AdminCases />,
		permission: "case_manage",
		activity: "manage",
		nav: { label: "病例库", icon: UserSearch, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/assignments",
		element: <AssignmentsPage />,
		permission: "assignment_manage",
		activity: "manage",
		nav: { label: "作业管理", icon: ClipboardList, section: "admin", group: "teaching" },
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
		permission: "score_review",
		activity: "manage",
		nav: { label: "教学看板", icon: BarChart3, section: "admin", group: "teaching", end: true },
	},
	{
		path: "/admin/records",
		element: <TeacherRecordsPage />,
		permission: "score_review",
		activity: "manage",
		nav: { label: "训练记录", icon: FileText, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/records/:id",
		element: <TeacherRecordDetail />,
		permission: "score_review",
		activity: "manage",
	},
	{
		path: "/admin/rubric",
		element: <RubricPage />,
		permission: "score_review",
		activity: "manage",
		nav: { label: "评分标准", icon: BookOpen, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/costs",
		element: <CostManagement />,
		permission: "llm_monitor",
		activity: "manage",
		nav: { label: "成本管理", icon: Coins, section: "admin", group: "system" },
	},
	{
		path: "/admin/system-ops",
		element: <SystemOpsPage />,
		permission: "api_manage",
		activity: "manage",
		nav: { label: "运维仪表盘", icon: ActivityIcon, section: "admin", group: "system" },
	},
	{
		path: "/admin/system-notifications",
		element: <SystemNotificationsPage />,
		permission: "api_manage",
		activity: "manage",
		nav: { label: "系统通知", icon: Megaphone, section: "admin", group: "system" },
	},
];

export interface NavItem extends NavMeta {
	to: string;
	permission?: Permission;
}

export const NAV_ITEMS: NavItem[] = APP_ROUTES.filter(
	(r): r is AppRoute & { nav: NavMeta } => !!r.nav,
).map((r) => ({ to: r.path, permission: r.permission, ...r.nav }));
