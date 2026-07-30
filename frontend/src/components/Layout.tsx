import { AlertTriangle, MessageSquare, Stethoscope, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import AdaptiveShell from "@/components/shell/AdaptiveShell";
import { NAV_ITEMS } from "@/components/shell/navigation";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
		<div className="min-h-[50vh] rounded-xl border border-border bg-card p-4">
			<div className="space-y-4">
				<div className="h-6 w-40 animate-pulse rounded bg-muted" />
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="h-28 animate-pulse rounded-lg bg-muted/70" />
					<div className="h-28 animate-pulse rounded-lg bg-muted/50" />
				</div>
				<div className="h-40 animate-pulse rounded-lg bg-muted/60" />
			</div>
		</div>
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
		es.onerror = () => { es.close(); };
		return () => { es.close(); };
	}, []);
	if (!warning?.active) return null;
	return (
		<div className="flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 shrink-0">
			<AlertTriangle size={16} className="shrink-0" />
			<span className="flex-1">{warning.message || "系统即将更新，可能短暂中断"}</span>
		</div>
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
				<div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 md:hidden shrink-0">
					<span className="flex-1">管理后台建议使用桌面端访问以获得完整体验</span>
					<button
						type="button"
						aria-label="关闭提示"
						className="shrink-0 text-amber-700 hover:text-amber-900"
						onClick={() => setMobileHintDismissed(true)}
					>
						<X size={13} />
					</button>
				</div>
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
			<Dialog open={aboutOpen} onOpenChange={(o) => !o && setAboutOpen(false)}>
				<DialogContent title="关于系统" maxWidth={560}>
					<div className="space-y-3 py-2 text-center">
						<div className="flex justify-center">
							<div className="flex size-12 items-center justify-center rounded-xl bg-primary shadow">
								<Stethoscope size={24} className="text-primary-foreground" />
							</div>
						</div>
						<div>
							<h3 className="text-lg font-semibold">虚拟患者系统</h3>
							<p className="text-sm text-muted-foreground">护理病史采集技能训练平台</p>
							<p className="mt-2 text-xs text-muted-foreground">版本 {APP_VERSION}</p>
						</div>
						<Button variant="outline" size="sm" className="w-full" onClick={() => { setAboutOpen(false); openFeedback(); }}>
							<MessageSquare size={14} />意见反馈
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
