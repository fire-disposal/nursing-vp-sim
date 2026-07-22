import {
	Activity,
	BarChart3,
	Bell,
	BookOpen,
	ClipboardCheck,
	ClipboardList,
	Coins,
	FileText,
	GraduationCap,
	HelpCircle,
	Home,
	type LucideIcon,
	Megaphone,
	MessageSquare,
	Settings,
	Shield,
	Stethoscope,
	UserSearch,
	Users,
} from "lucide-react";
import { lazy, type ReactNode } from "react";
import type { Permission } from "@/utils/permissions";

const DashboardHome = lazy(() => import("@/pages/DashboardHome"));
const TrainingSelect = lazy(() => import("@/pages/TrainingSelect"));
const TrainingEntry = lazy(() => import("@/pages/TrainingEntry"));
const History = lazy(() => import("@/pages/History"));
const RecordDetail = lazy(() => import("@/pages/RecordDetail"));
const QA = lazy(() => import("@/pages/QA"));
const StatsPage = lazy(() =>
	import("@/pages/Stats").then((m) => ({ default: m.StatsPage })),
);
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
const AdminQuestionnaires = lazy(() => import("@/pages/AdminQuestionnaires"));
const SystemOpsPage = lazy(() => import("@/pages/admin/SystemOpsPage"));
const SystemNotificationsPage = lazy(
	() => import("@/pages/admin/SystemNotificationsPage"),
);
const TeacherRecordsPage = lazy(
	() => import("@/pages/admin/TeacherRecordsPage"),
);
const RubricPage = lazy(() => import("@/pages/admin/RubricPage"));

export type NavSection = "user" | "admin";

export type NavGroupKey = "teaching" | "people" | "system" | "feedback";

export interface NavGroupDef {
	key: NavGroupKey;
	label: string;
	icon: LucideIcon;
	defaultOpen: boolean;
}

export const NAV_GROUPS: NavGroupDef[] = [
	{ key: "teaching", label: "教学中心", icon: GraduationCap, defaultOpen: true },
	{ key: "people", label: "人员管理", icon: Users, defaultOpen: false },
	{ key: "system", label: "系统运维", icon: Activity, defaultOpen: false },
	{ key: "feedback", label: "反馈中心", icon: MessageSquare, defaultOpen: false },
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
	nav?: NavMeta;
}

export const APP_ROUTES: AppRoute[] = [
	// ── User area ──
	{
		path: "/home",
		element: <DashboardHome />,
		nav: { label: "首页", icon: Home, section: "user", end: true },
	},
	{
		path: "/training",
		element: <TrainingSelect />,
		permission: "training_access",
		nav: {
			label: "病例训练",
			shortLabel: "训练",
			icon: Stethoscope,
			section: "user",
		},
	},
	{
		path: "/training/:recordId",
		element: <TrainingEntry />,
		permission: "training_access",
	},
	{
		path: "/history",
		element: <History />,
		nav: {
			label: "训练记录",
			shortLabel: "记录",
			icon: ClipboardList,
			section: "user",
		},
	},
	{ path: "/record/:id", element: <RecordDetail /> },
	{
		path: "/my-feedback",
		element: <MyFeedbackPage />,
		nav: {
			label: "我的反馈",
			icon: MessageSquare,
			section: "user",
		},
	},
	{
		path: "/notifications",
		element: <NotificationInboxPage />,
		nav: {
			label: "通知中心",
			icon: Bell,
			section: "user",
		},
	},
	{
		path: "/qa",
		element: <QA />,
		permission: "qa_access",
		nav: {
			label: "护理问答",
			shortLabel: "问答",
			icon: HelpCircle,
			section: "user",
		},
	},
	{
		path: "/stats",
		element: <StatsPage />,
		permission: "stats_view",
		nav: {
			label: "训练统计",
			shortLabel: "统计",
			icon: BarChart3,
			section: "user",
		},
	},
	{
		path: "/my-responses",
		element: <MyResponses />,
		nav: {
			label: "我的问卷",
			shortLabel: "问卷",
			icon: ClipboardCheck,
			section: "user",
		},
	},
	{ path: "/profile", element: <Profile /> },

	// ── Admin area ──
	{
		path: "/admin/users",
		element: <AdminUsers />,
		permission: "user_manage",
		nav: { label: "用户管理", icon: Users, section: "admin", group: "people" },
	},
	{
		path: "/admin/users/:userId",
		element: <AdminUserDetail />,
		permission: "user_manage",
	},
	{
		path: "/admin/roles",
		element: <AdminRoles />,
		permission: "role_manage",
		nav: { label: "角色管理", icon: Shield, section: "admin", group: "people" },
	},
	{
		path: "/admin/grades-classes",
		element: <AdminGradesClasses />,
		permission: "grade_class_manage",
		nav: { label: "班级管理", icon: GraduationCap, section: "admin", group: "people" },
	},
	{
		path: "/admin/cases",
		element: <AdminCases />,
		permission: "case_manage",
		nav: { label: "病例库", icon: UserSearch, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/assignments",
		element: <AssignmentsPage />,
		permission: "assignment_manage",
		nav: { label: "作业管理", icon: ClipboardList, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/assignments/:id",
		element: <AssignmentDetailPage />,
		permission: "assignment_manage",
	},
	{
		path: "/admin",
		element: <Admin />,
		permission: "score_review",
		nav: { label: "教学看板", icon: Settings, section: "admin", group: "teaching", end: true },
	},
	{
		path: "/admin/records",
		element: <TeacherRecordsPage />,
		permission: "score_review",
		nav: { label: "训练记录", icon: FileText, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/rubric",
		element: <RubricPage />,
		permission: "score_review",
		nav: { label: "评分标准", icon: BookOpen, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/costs",
		element: <CostManagement />,
		permission: "llm_monitor",
		nav: { label: "成本管理", icon: Coins, section: "admin", group: "system" },
	},
	{
		path: "/admin/feedback",
		element: <AdminFeedback />,
		permission: "feedback_review",
		nav: { label: "用户反馈", icon: MessageSquare, section: "admin", group: "feedback" },
	},
	{
		path: "/admin/questionnaires",
		element: <AdminQuestionnaires />,
		permission: "questionnaire_manage",
		nav: { label: "问卷管理", icon: ClipboardCheck, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/system-ops",
		element: <SystemOpsPage />,
		permission: "api_manage",
		nav: { label: "运维仪表盘", icon: Activity, section: "admin", group: "system" },
	},
	{
		path: "/admin/system-notifications",
		element: <SystemNotificationsPage />,
		permission: "api_manage",
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
