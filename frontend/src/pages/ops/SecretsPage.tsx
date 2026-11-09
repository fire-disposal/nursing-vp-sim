import { IconKey } from "@tabler/icons-react";
import ApiManagementTab from "@/components/admin/monitor/ApiManagementTab";
import PageHeader from "@/components/ui/page-header";

/**
 * LLM/语音服务的调用凭据。权限由路由层把关（llm_monitor，与迁出前的成本管理一致），
 * 页面本身不判权限，避免第二份真相。
 */
export default function SecretsPage() {
	return (
		<>
			<PageHeader
				title="API 密钥"
				subtitle="LLM 与语音服务的调用凭据：新增、轮换、连通性测试与配额"
				icon={IconKey}
			/>
			<ApiManagementTab />
		</>
	);
}
