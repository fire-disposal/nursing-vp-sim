import { IconWifiOff } from "@tabler/icons-react";
import { StatusStrip } from "@/components/ui/status-strip";

/**
 * 断网状态条 —— 挂在有壳的页面上（`ManageShell`）。
 *
 * 文案说清"能做什么/不能做什么"，不再写"部分功能不可用"（学生不知道是哪部分）。
 * 训练页是沉浸壳、没有这条，改由对话列里的 `ConnectionNotice` 承担同一职责。
 */
export function NetworkBanner() {
	return (
		<StatusStrip tone="warn" icon={<IconWifiOff size={14} />}>
			网络已断开：发送、保存与提交会失败；恢复后自动继续
		</StatusStrip>
	);
}
