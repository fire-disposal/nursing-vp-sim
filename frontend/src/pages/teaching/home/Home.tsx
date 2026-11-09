import useAuthStore from "@/stores/authStore";
import AdminHome from "./AdminHome";
import TeacherHome from "./TeacherHome";

/**
 * `/admin` 的首页分派：**职责不同，页面不同**。
 *
 * - 教师：教学看板（待批阅/作业/成绩）；
 * - 院校管理员：管理常用（用户/班级/视角/反馈）+ 教学看板。
 *
 * 这里只做一次二选一，不把两套布局塞进同一个组件；两者共享的数据视图仍在
 * `dashboard/TeachingDashboard`。
 */
export default function Home() {
	const canManageUsers = useAuthStore((s) => s.permissions.includes("user_manage"));
	return canManageUsers ? <AdminHome /> : <TeacherHome />;
}
