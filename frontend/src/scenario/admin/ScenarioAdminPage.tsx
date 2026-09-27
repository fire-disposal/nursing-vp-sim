import { Alert, Tabs, Text } from "@mantine/core";
import {
	IconAlertTriangle,
	IconChartBar,
	IconDatabase,
	IconPackages,
	IconSparkles,
} from "@tabler/icons-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import Forbidden from "@/components/ui/forbidden";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
// 管理侧回放复用学生侧的场景/舞台组件（`sc-*` 类），样式只有这一份来源。
// 不引进来时，这些类在 `/scenario-admin` 直接访问（不经由 /scenario）会整片失样式。
import "../scenario.css";
import AdminAssetsPanel from "./AdminAssetsPanel";
import AdminGeneratedPanel from "./AdminGeneratedPanel";
import AdminPacksPanel from "./AdminPacksPanel";
import AdminSessionsPanel from "./AdminSessionsPanel";
import AdminStatsPanel from "./AdminStatsPanel";

/**
 * 情境训练 · 管理侧 —— 隐藏路由 `/scenario-admin`，不出现在导航。
 *
 * 四块：**包**（上传/改状态）、**资源**（上传图片字节/预览/撤下）、**会话**（回放 + 诊断 + 事件）、
 * **统计**（按包的会话与锚点分布）。
 *
 * 权限沿用既有键：内容用 `case_manage`，数据用 `stats_view`。两者都缺 → 403 页；
 * 只有一半时**只显示有权限的那一半**（后端也是这么分的，前端不该比后端宽松或更严）。
 * 权限门在这里而不是路由表：一个路由只能声明一个权限，而本页需要两个不同的权限。
 */
export default function ScenarioAdminPage() {
	const permissions = useAuthStore(useShallow((s) => s.permissions));
	const canContent = permissions.includes("case_manage");
	const canData = permissions.includes("stats_view");
	const [tab, setTab] = useState<string | null>(null);
	const [packKey, setPackKey] = useState<string | null>(null);
	/** 从「生成物」点会话 id 跳回放时带过去的会话（会话页据此自动展开）。 */
	const [focusSession, setFocusSession] = useState<number | null>(null);

	if (!canContent && !canData) {
		return (
			<>
				<PageHeader
					title="情境训练 · 管理"
					subtitle="情境包、资源与情境数据"
					icon={IconPackages}
				/>
				<Text size="sm" c="dimmed" mb="xs">
					这个页面需要「病例内容管理」或「数据查看」权限：前者管情境包与图片，后者看会话与统计。
				</Text>
				<Forbidden />
			</>
		);
	}

	// 默认落在第一个有权限的分页：内容侧第一个是 `packs`，数据侧第一个是 `sessions`。
	// （两者都无权限的情况在上面已经 403 返回，不会走到这里。）
	const firstTab = canContent ? "packs" : "sessions";
	const value = tab ?? firstTab;

	return (
		<>
			<PageHeader
				title="情境训练 · 管理"
				subtitle="情境包与资源在这里上传；会话回放里的诊断信息仅维护者可见"
				icon={IconPackages}
			/>

			<Alert
				color="orange"
				variant="light"
				icon={<IconAlertTriangle size={16} />}
				mb="md"
			>
				诊断信息（dm_parse、leaked_fact_term 这类原始串）仅维护者可见，
				学生界面只会看到一句人话。请勿把这些原始串截图转发给学生。
			</Alert>

			<Tabs value={value} onChange={setTab} keepMounted={false}>
				<Tabs.List mb="md">
					{canContent && (
						<Tabs.Tab value="packs" leftSection={<IconPackages size={15} />}>
							情境包
						</Tabs.Tab>
					)}
					{canContent && (
						<Tabs.Tab value="assets" leftSection={<IconDatabase size={15} />}>
							资源
						</Tabs.Tab>
					)}
					{canContent && (
						<Tabs.Tab value="generated" leftSection={<IconSparkles size={15} />}>
							生成物
						</Tabs.Tab>
					)}
					{canData && (
						<Tabs.Tab value="sessions" leftSection={<IconChartBar size={15} />}>
							会话
						</Tabs.Tab>
					)}
					{canData && (
						<Tabs.Tab value="stats" leftSection={<IconChartBar size={15} />}>
							统计
						</Tabs.Tab>
					)}
				</Tabs.List>

				{canContent && (
					<Tabs.Panel value="packs">
						<AdminPacksPanel
							onManageAssets={(key) => {
								setPackKey(key);
								setTab("assets");
							}}
						/>
					</Tabs.Panel>
				)}
				{canContent && (
					<Tabs.Panel value="assets">
						<AdminAssetsPanel packKey={packKey} onPackKeyChange={setPackKey} />
					</Tabs.Panel>
				)}
				{canContent && (
					<Tabs.Panel value="generated">
						<AdminGeneratedPanel
							packKey={packKey}
							onPackKeyChange={setPackKey}
							onOpenSession={(sessionId) => {
								setFocusSession(sessionId);
								setTab("sessions");
							}}
						/>
					</Tabs.Panel>
				)}
				{canData && (
					<Tabs.Panel value="sessions">
						<AdminSessionsPanel focusSessionId={focusSession} />
					</Tabs.Panel>
				)}
				{canData && (
					<Tabs.Panel value="stats">
						<AdminStatsPanel />
					</Tabs.Panel>
				)}
			</Tabs>
		</>
	);
}
