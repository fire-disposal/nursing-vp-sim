import QuestionnairesTab from "@/components/admin/QuestionnairesTab";

/**
 * 页头由 `QuestionnairesTab` 自己渲染（同 UsersTab）：主行动「新建问卷」与列表筛选
 * 必须共享同一份状态，页头留在路由层就只能靠提升状态再跨组件传回来。
 */
export default function AdminQuestionnaires() {
	return <QuestionnairesTab />;
}
