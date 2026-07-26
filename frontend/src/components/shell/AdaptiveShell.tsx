import type { ReactNode } from "react";
import { ActivityProvider, useActivity } from "./ActivityContext";
import ManageShell from "./ManageShell";
import PracticeShell from "./PracticeShell";
import type { NavItem } from "./navigation";

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

	switch (activity) {
		case "practice":
			return <PracticeShell>{children}</PracticeShell>;
		default:
			return (
				<ManageShell
					userLinks={userLinks}
					adminLinks={adminLinks}
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
