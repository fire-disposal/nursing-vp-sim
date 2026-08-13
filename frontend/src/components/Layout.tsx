import { ActionIcon, Box, Button, Group, Modal, Skeleton, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconMessageCircle, IconStethoscope, IconX } from "@tabler/icons-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import AdaptiveShell from "@/components/shell/AdaptiveShell";
import { NAV_ITEMS } from "@/components/shell/navigation";

import useAuthStore from "@/stores/authStore";
import { useUiPrefsStore } from "@/stores/uiPrefsStore";
import { isAdminPermissions } from "@/utils/permissions";
import { APP_VERSION } from "@/version";

/**
 * Layout — 应用层编排
 *
 * 职责：权限过滤、登出、About 对话框、移动端提示。
 * 不再包含路由判断或 Shell 选择——这些委托给 AdaptiveShell。
 */
function RouteContentLoader() {
	return (
		<Box p="md" style={{ minHeight: "50vh", borderRadius: "var(--mantine-radius-lg)", border: "1px solid var(--mantine-color-gray-3)", background: "var(--mantine-color-body)" }}>
			<Stack gap="md">
				<Skeleton height={24} width={160} />
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
					<Skeleton height={112} />
					<Skeleton height={112} />
				</SimpleGrid>
				<Skeleton height={160} />
			</Stack>
		</Box>
	);
}

function DeployBanner() {
	const [warning, setWarning] = useState<{ active: boolean; message?: string } | null>(null);
	useEffect(() => {
		const es = new EventSource("/api/deploy-status/stream");
		es.onmessage = (ev) => {
			try {
				const data = JSON.parse(ev.data) as { active: boolean; message?: string };
				setWarning(data.active ? data : null);
			} catch { /* ignore */ }
		};
		// 不人工 close：让 EventSource 自动重连。后端容器随部署重启时
		// SSE 会断开，自动重连后新后端推送 {"active": false} 即可清除横幅。
		es.onerror = () => { /* auto-reconnect, don't close */ };
		return () => { es.close(); };
	}, []);
	if (!warning) return null;
	const msg = warning.message || "系统即将更新，可能短暂中断";
	return (
		<Box
			style={{
				position: "fixed",
				insetInline: 0,
				top: 0,
				zIndex: 50,
				display: "flex",
				justifyContent: "center",
				paddingTop: 10,
				pointerEvents: "none",
			}}
		>
			<Box
				style={{
					pointerEvents: "auto",
					width: 320,
					overflow: "hidden",
					borderRadius: 999,
					background: "rgba(245, 158, 11, 0.9)",
					paddingTop: 4,
					paddingBottom: 4,
					color: "white",
					boxShadow: "var(--mantine-shadow-lg)",
				}}
			>
				<Box
					style={{
						display: "flex",
						width: "max-content",
						whiteSpace: "nowrap",
						animation: "marquee 18s linear infinite",
					}}
				>
					{[0, 1, 2].map((i) => (
						<span
							key={i}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								padding: "0 24px",
								fontSize: 14,
								fontWeight: 500,
							}}
						>
							<IconAlertTriangle size={13} />
							{msg}
						</span>
					))}
				</Box>
			</Box>
		</Box>
	);
}

export default function Layout() {
	const navigate = useNavigate();
	const permissions = useAuthStore((s) => s.permissions);
	const logout = useAuthStore((s) => s.logout);
	const permKey = permissions.join(",");
	const [aboutOpen, setAboutOpen] = useState(false);
	const mobileHintDismissed = useUiPrefsStore((s) => s.mobileHintDismissed);
	const setMobileHintDismissed = useUiPrefsStore(
		(s) => s.setMobileHintDismissed,
	);
	const { openFeedback } = useFeedback();

	const hasAdminPerm = isAdminPermissions(permissions);

	const { userLinks, adminLinks } = useMemo(() => {
		const filtered = NAV_ITEMS.filter(
			(l) => !l.permission || permissions.includes(l.permission),
		);
		return {
			userLinks: filtered.filter((l) => l.section === "user"),
			adminLinks: filtered.filter((l) => l.section === "admin"),
		};
	}, [permKey]);

	const handleLogout = () => {
		logout();
		navigate("/login");
	};

	return (
		<>
			{/* Mobile hint — admin only */}
			{hasAdminPerm && !mobileHintDismissed && (
				<Group
					gap={8}
					px="md"
					py={4}
					hiddenFrom="sm"
					wrap="nowrap"
					style={{
						flexShrink: 0,
						borderBottom: "1px solid var(--mantine-color-yellow-2)",
						background: "var(--mantine-color-yellow-0)",
					}}
				>
					<Text size="xs" c="yellow.9" style={{ flex: 1 }}>
						管理后台建议使用桌面端访问以获得完整体验
					</Text>
					<ActionIcon
						variant="transparent"
						color="yellow.9"
						size="xs"
						onClick={() => setMobileHintDismissed(true)}
						aria-label="关闭提示"
					>
						<IconX size={13} />
					</ActionIcon>
				</Group>
			)}

			<DeployBanner />
			<AdaptiveShell
				userLinks={userLinks}
				adminLinks={adminLinks}
				onLogout={handleLogout}
				onAbout={() => setAboutOpen(true)}
			>
				<Suspense fallback={<RouteContentLoader />}>
					<Outlet />
				</Suspense>
			</AdaptiveShell>

			{/* About dialog */}
			<Modal opened={aboutOpen} onClose={() => setAboutOpen(false)} title="关于系统" size={560} centered withinPortal>
					<Stack gap="sm" py="xs" align="center">
						<Box
							style={{
								width: 48,
								height: 48,
								borderRadius: "var(--mantine-radius-lg)",
								background: "var(--mantine-color-teal-6)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								boxShadow: "var(--mantine-shadow-sm)",
							}}
						>
							<IconStethoscope size={24} style={{ color: "white" }} />
						</Box>
						<Box ta="center">
							<Title order={3}>虚拟患者系统</Title>
							<Text size="sm" c="dimmed">
								护理病史采集技能训练平台
							</Text>
							<Text size="xs" c="dimmed" mt="xs">
								版本 {APP_VERSION}
							</Text>
						</Box>
						<Button
							variant="outline"
							size="sm"
							fullWidth
							onClick={() => {
								setAboutOpen(false);
								openFeedback();
							}}
						>
							<IconMessageCircle size={14} />
							意见反馈
						</Button>
					</Stack>
				</Modal>
		</>
	);
}
