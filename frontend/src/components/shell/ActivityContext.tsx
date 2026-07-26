import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { Activity } from "./navigation";
import { APP_ROUTES } from "./navigation";

const ActivityContext = createContext<Activity>("manage");

/**
 * Derive the current Activity from the URL path by matching against APP_ROUTES.
 * Falls back to "manage" for unmatched paths (shouldn't happen post-login).
 */
function matchActivity(pathname: string): Activity {
	for (const route of APP_ROUTES) {
		// Exact match
		if (route.path === pathname) return route.activity;
		// Parameterized match: /training/:recordId, /record/:id, /admin/users/:userId, etc.
		const pattern = route.path.replace(/:\w+/g, "[^/]+");
		if (new RegExp(`^${pattern}$`).test(pathname)) return route.activity;
	}
	return "manage";
}

export function ActivityProvider({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	const activity = useMemo(() => matchActivity(pathname), [pathname]);
	return (
		<ActivityContext.Provider value={activity}>
			{children}
		</ActivityContext.Provider>
	);
}

export function useActivity(): Activity {
	return useContext(ActivityContext);
}
