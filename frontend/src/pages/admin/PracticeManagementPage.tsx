import { lazy, Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/utils/cn";
import type { Permission } from "@/utils/permissions";

const PracticesPage = lazy(() => import("@/pages/admin/PracticesPage"));
const AssignmentsPage = lazy(() => import("@/pages/admin/AssignmentsPage"));

const ALL_TABS = [
	{ key: "templates", label: "练习模板", permission: "case_manage" as Permission },
	{ key: "assignments", label: "练习发布", permission: "assignment_manage" as Permission },
] as const;

function TabLoader() {
	return (
		<div className="flex items-center justify-center py-12">
			<div className="size-6 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
		</div>
	);
}

export default function PracticeManagementPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const permissions = useAuthStore((s) => s.permissions);
	const activeTab = searchParams.get("tab") || "templates";

	const tabs = useMemo(
		() => ALL_TABS.filter((t) => permissions.includes(t.permission)),
		[permissions],
	);

	const effectiveTab = tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0]?.key ?? "templates";

	const switchTab = useCallback(
		(key: string) => {
			setSearchParams({ tab: key }, { replace: true });
		},
		[setSearchParams],
	);

	return (
		<div className="space-y-4">
			<PageHeader
				title="练习管理"
				subtitle="管理练习模板与班级发布。模板定义训练参数，发布将模板下发到班级。"
			/>

			{tabs.length > 1 && (
			<div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
				{tabs.map((t) => (
					<button
						type="button"
						key={t.key}
						onClick={() => switchTab(t.key)}
						className={cn(
							"rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
							effectiveTab === t.key
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{t.label}
					</button>
				))}
			</div>
			)}

			<Suspense fallback={<TabLoader />}>
				{effectiveTab === "templates" ? (
					<PracticesPage embedded />
				) : (
					<AssignmentsPage embedded />
				)}
			</Suspense>
		</div>
	);
}