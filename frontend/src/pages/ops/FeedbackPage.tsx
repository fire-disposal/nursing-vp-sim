import FeedbackTab from "@/components/admin/FeedbackTab";

/**
 * 页头由 `FeedbackTab` 自己渲染（同 UsersTab）：导出按钮要跟随列表筛选，
 * 两者必须共享同一份状态。
 */
export default function FeedbackPage() {
	return <FeedbackTab />;
}
