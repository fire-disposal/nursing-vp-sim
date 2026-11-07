import type { ReactNode } from "react";
import { usePersonaStore } from "@/stores/personaStore";
import { ActivityProvider, useActivity } from "./ActivityContext";
import ManageShell from "./ManageShell";
import { filterNavByPersona, type NavItem } from "./navigation";
import PracticeShell from "./PracticeShell";

function ShellPicker({
	userLinks,
	adminLinks,
	onLogout,
	onAbout,
	children,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	onLogout: () => void;
	onAbout: () => void;
	children: ReactNode;
}) {
	const activity = useActivity();
	// 视角过滤的落点在壳里（侧栏与底部 Tab 都在这里渲染）：单点做一次，
	// 任何调用方（Layout / 未来的壳挂点）都不用记得处理视角，也就不会漏。
	const persona = usePersonaStore((s) => s.active);
	const navUserLinks = filterNavByPersona(userLinks, persona);
	const navAdminLinks = filterNavByPersona(adminLinks, persona);

	switch (activity) {
		case "practice":
			return <PracticeShell>{children}</PracticeShell>;
		default:
			return (
				<ManageShell
					userLinks={navUserLinks}
					adminLinks={navAdminLinks}
					onLogout={onLogout}
					onAbout={onAbout}
				>
					{children}
				</ManageShell>
			);
	}
}

/**
 * AdaptiveShell — 统一的外壳入口
 *
 * 用 ActivityContext 包裹 children，然后根据当前 activity 选择对应的 Shell。
 * 替换旧 Layout.tsx 中基于路径的四分支 if-else 派发。
 */
export default function AdaptiveShell({
	userLinks,
	adminLinks,
	onLogout,
	onAbout,
	children,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	onLogout: () => void;
	onAbout: () => void;
	children: ReactNode;
}) {
	return (
		<ActivityProvider>
			<ShellPicker
				userLinks={userLinks}
				adminLinks={adminLinks}
				onLogout={onLogout}
				onAbout={onAbout}
			>
				{children}
			</ShellPicker>
		</ActivityProvider>
	);
}
