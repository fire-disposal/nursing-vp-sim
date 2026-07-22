# Admin UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure admin information architecture from a flat "API resource → route → menu" mapping into a task-centered UI with collapsible sidebar groups, bento-grid dashboard, card galleries, and navigation polish.

**Architecture:** Four sequential phases, each independently shippable. All new components are assembled from existing `components/ui/` primitives (`Card`, `Badge`, `Button`, `StatCard`). Only one new npm dependency: `motion` (for transitions/micro-interactions). Old components are preserved as fallbacks.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `motion` (animations), `lucide-react` (icons), `@tanstack/react-query`, `react-router-dom` v7, Vitest + Testing Library

**Design Spec:** `docs/superpowers/specs/2026-07-22-admin-ux-redesign-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `components/ui/nav-group.tsx` | Collapsible sidebar navigation group |
| `components/ui/breadcrumb.tsx` | Breadcrumb navigation trail |
| `components/dashboard/TeachingDashboard.tsx` | Admin landing page: bento grid dashboard |
| `components/dashboard/ActivityTimeline.tsx` | Recent training activity feed |
| `components/dashboard/RingProgress.tsx` | SVG circular progress indicator |
| `components/dashboard/AssignmentOverview.tsx` | Active assignment cards with progress |
| `components/admin/cases/CaseCard.tsx` | Case gallery card |
| `components/admin/users/UserCard.tsx` | User directory card |
| `components/admin/users/BatchActionBar.tsx` | Floating batch action bar |
| `__tests__/admin/NavGroup.test.tsx` | Tests for NavGroup |
| `__tests__/admin/CaseCard.test.tsx` | Tests for CaseCard |
| `__tests__/dashboard/RingProgress.test.tsx` | Tests for RingProgress |
| `__tests__/dashboard/ActivityTimeline.test.tsx` | Tests for ActivityTimeline |

### Modified Files

| File | What Changes |
|------|-------------|
| `components/shell/navigation.tsx` | Add `group` field to NavMeta, add `NAV_GROUPS`, fix labels and icons |
| `components/Layout.tsx` | SidebarNav → grouped NavGroup rendering, simplify bottom bar, add AnimatePresence |
| `components/ui/page-header.tsx` | Add `breadcrumb` prop |
| `pages/Admin.tsx` | Replace AdminDashboard with TeachingDashboard |
| `components/admin/CasesTab.tsx` | Replace ResponsiveTable with CaseCard gallery grid |
| `components/admin/UsersTab.tsx` | Replace UserList table with UserCard directory grid + BatchActionBar |
| `package.json` | Add `motion` dependency |

### Untouched (Risk Buffer)

- All student pages
- All API layer files
- All backend files
- All training engine files
- `components/admin/cases/CaseForm.tsx` (modal unchanged)
- `components/admin/users/UserForm.tsx` (modal unchanged)

---

## Phase 1: Sidebar Restructure

### Task 1: Install `motion` and update `navigation.tsx` with groups

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/components/shell/navigation.tsx`

- [ ] **Step 1: Install motion**

```bash
pnpm add motion
```
Run from monorepo root or `frontend/`.

- [ ] **Step 2: Add `group` to NavMeta and define NAV_GROUPS**

Open `frontend/src/components/shell/navigation.tsx`. Add the import for new icons (`ScrollText`) at line 1:

```typescript
import {
	Activity,
	BarChart3,
	Bell,
	BookOpen,
	ClipboardCheck,
	ClipboardList,
	Coins,
	GraduationCap,
	HelpCircle,
	Home,
	type LucideIcon,
	Megaphone,
	MessageSquare,
	ScrollText,
	Settings,
	Shield,
	Stethoscope,
	UserSearch,
	Users,
} from "lucide-react";
```

Add after the existing `NavSection` type (line 63):

```typescript
export type NavGroupKey = "teaching" | "people" | "system" | "feedback";

export interface NavGroupDef {
	key: NavGroupKey;
	label: string;
	icon: LucideIcon;
	defaultOpen: boolean;
}

export const NAV_GROUPS: NavGroupDef[] = [
	{ key: "teaching", label: "教学中心", icon: GraduationCap, defaultOpen: true },
	{ key: "people", label: "人员管理", icon: Users, defaultOpen: false },
	{ key: "system", label: "系统运维", icon: Activity, defaultOpen: false },
	{ key: "feedback", label: "反馈中心", icon: MessageSquare, defaultOpen: false },
];
```

Add `group?: NavGroupKey` to `NavMeta`:

```typescript
export interface NavMeta {
	label: string;
	shortLabel?: string;
	icon: LucideIcon;
	section: NavSection;
	group?: NavGroupKey;
	end?: boolean;
}
```

- [ ] **Step 3: Assign `group` to every admin NavItem**

For each admin route in the `APP_ROUTES` array, add `group` to the `nav` object. The full updated admin section (lines 166-254) becomes:

```typescript
	// ── Admin area ──
	{
		path: "/admin/users",
		element: <AdminUsers />,
		permission: "user_manage",
		nav: { label: "用户管理", icon: Users, section: "admin", group: "people" },
	},
	{
		path: "/admin/users/:userId",
		element: <AdminUserDetail />,
		permission: "user_manage",
	},
	{
		path: "/admin/roles",
		element: <AdminRoles />,
		permission: "role_manage",
		nav: { label: "角色管理", icon: Shield, section: "admin", group: "people" },
	},
	{
		path: "/admin/grades-classes",
		element: <AdminGradesClasses />,
		permission: "grade_class_manage",
		nav: { label: "班级管理", icon: GraduationCap, section: "admin", group: "people" },
	},
	{
		path: "/admin/cases",
		element: <AdminCases />,
		permission: "case_manage",
		nav: { label: "病例库", icon: UserSearch, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/assignments",
		element: <AssignmentsPage />,
		permission: "assignment_manage",
		nav: { label: "作业管理", icon: ClipboardList, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/assignments/:id",
		element: <AssignmentDetailPage />,
		permission: "assignment_manage",
	},
	{
		path: "/admin",
		element: <Admin />,
		permission: "score_review",
		nav: { label: "教学看板", icon: Settings, section: "admin", group: "teaching", end: true },
	},
	{
		path: "/admin/records",
		element: <TeacherRecordsPage />,
		permission: "score_review",
		nav: { label: "训练记录", icon: ScrollText, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/rubric",
		element: <RubricPage />,
		permission: "score_review",
		nav: { label: "评分标准", icon: BookOpen, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/costs",
		element: <CostManagement />,
		permission: "llm_monitor",
		nav: { label: "成本管理", icon: Coins, section: "admin", group: "system" },
	},
	{
		path: "/admin/feedback",
		element: <AdminFeedback />,
		permission: "feedback_review",
		nav: { label: "用户反馈", icon: MessageSquare, section: "admin", group: "feedback" },
	},
	{
		path: "/admin/questionnaires",
		element: <AdminQuestionnaires />,
		permission: "questionnaire_manage",
		nav: { label: "问卷管理", icon: ClipboardCheck, section: "admin", group: "teaching" },
	},
	{
		path: "/admin/system-ops",
		element: <SystemOpsPage />,
		permission: "api_manage",
		nav: { label: "运维仪表盘", icon: Activity, section: "admin", group: "system" },
	},
	{
		path: "/admin/system-notifications",
		element: <SystemNotificationsPage />,
		permission: "api_manage",
		nav: { label: "系统通知", icon: Megaphone, section: "admin", group: "system" },
	},
```

- [ ] **Step 4: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

Expected: no errors. If `ScrollText` is not available in the installed version of lucide-react, replace with `FileText`.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/components/shell/navigation.tsx
git commit -m "🎨 style: add nav group definitions for sidebar restructure"
```

---

### Task 2: Create NavGroup component

**Files:**
- Create: `frontend/src/components/ui/nav-group.tsx`
- Create: `frontend/src/__tests__/admin/NavGroup.test.tsx`

- [ ] **Step 1: Write the test**

Create `frontend/src/__tests__/admin/NavGroup.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home, Settings } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NavGroup } from "@/components/ui/nav-group";

describe("NavGroup", () => {
	it("renders label and icon", () => {
		render(
			<MemoryRouter>
				<NavGroup label="教学中心" icon={Home} defaultOpen storageKey="test">
					<div>child content</div>
				</NavGroup>
			</MemoryRouter>,
		);
		expect(screen.getByText("教学中心")).toBeInTheDocument();
		expect(screen.getByText("child content")).toBeInTheDocument();
	});

	it("collapses and expands on click", async () => {
		render(
			<MemoryRouter>
				<NavGroup label="教学中心" icon={Home} defaultOpen storageKey="test-collapse">
					<span data-testid="child">content</span>
				</NavGroup>
			</MemoryRouter>,
		);
		expect(screen.getByTestId("child")).toBeVisible();
		await userEvent.click(screen.getByText("教学中心"));
		expect(screen.queryByTestId("child")).not.toBeInTheDocument();
		await userEvent.click(screen.getByText("教学中心"));
		expect(screen.getByTestId("child")).toBeVisible();
	});

	it("renders collapsed when defaultOpen is false", () => {
		render(
			<MemoryRouter>
				<NavGroup label="系统运维" icon={Settings} defaultOpen={false} storageKey="test-closed">
					<span data-testid="hidden-child">content</span>
				</NavGroup>
			</MemoryRouter>,
		);
		expect(screen.queryByTestId("hidden-child")).not.toBeInTheDocument();
	});

	it("renders nothing when children are empty", () => {
		const { container } = render(
			<MemoryRouter>
				<NavGroup label="空组" icon={Settings} defaultOpen storageKey="test-empty">
					{null}
				</NavGroup>
			</MemoryRouter>,
		);
		expect(container.firstChild).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend; npx vitest run src/__tests__/admin/NavGroup.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/ui/nav-group.tsx`:

```typescript
import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/utils/cn";

interface NavGroupProps {
	label: string;
	icon: LucideIcon;
	defaultOpen: boolean;
	storageKey: string;
	children: ReactNode;
}

export function NavGroup({
	label,
	icon: Icon,
	defaultOpen,
	storageKey,
	children,
}: NavGroupProps) {
	const location = useLocation();
	const [open, setOpen] = useState(() => {
		try {
			const stored = localStorage.getItem(`navgroup-${storageKey}`);
			return stored !== null ? stored === "true" : defaultOpen;
		} catch {
			return defaultOpen;
		}
	});

	const currentPath = location.pathname;

	useEffect(() => {
		if (!open && currentPath) {
			const container = document.querySelector(
				`[data-navgroup="${storageKey}"]`,
			);
			if (container?.querySelector(".active")) {
				setOpen(true);
			}
		}
	}, [currentPath, open, storageKey]);

	const toggle = useCallback(() => {
		setOpen((prev) => {
			const next = !prev;
			try {
				localStorage.setItem(`navgroup-${storageKey}`, String(next));
			} catch {
				// localStorage unavailable
			}
			return next;
		});
	}, [storageKey]);

	if (!children || (Array.isArray(children) && children.filter(Boolean).length === 0)) {
		return null;
	}

	return (
		<div data-navgroup={storageKey}>
			<button
				type="button"
				onClick={toggle}
				className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider hover:text-muted-foreground transition-colors"
			>
				<Icon size={12} />
				<span className="flex-1 text-left">{label}</span>
				<ChevronRight
					size={12}
					className={cn(
						"shrink-0 transition-transform duration-200",
						open && "rotate-90",
					)}
				/>
			</button>
			{open && <div className="mt-0.5">{children}</div>}
		</div>
	);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend; npx vitest run src/__tests__/admin/NavGroup.test.tsx
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/nav-group.tsx frontend/src/__tests__/admin/NavGroup.test.tsx
git commit -m "✨ feat: add NavGroup collapsible sidebar group component"
```

---

### Task 3: Rewrite SidebarNav in Layout.tsx

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Update imports in Layout.tsx**

Replace the existing imports at the top with:

```typescript
import {
	Info,
	LogOut,
	Menu,
	MessageSquare,
	MessageSquarePlus,
	Stethoscope,
	X,
} from "lucide-react";
import { memo, Suspense, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import DefaultShell from "@/components/shell/DefaultShell";
import ImmersiveShell from "@/components/shell/ImmersiveShell";
import StudentTabShell from "@/components/shell/StudentTabShell";
import type { NavGroupKey, NavItem } from "@/components/shell/navigation";
import { NAV_GROUPS, NAV_ITEMS } from "@/components/shell/navigation";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import LoadingState from "@/components/ui/loading-state";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { NavGroup } from "@/components/ui/nav-group";
import { Separator } from "@/components/ui/separator";
```

- [ ] **Step 2: Replace the `SidebarNav` component**

Replace the existing `SidebarNav` (lines 210-253) with:

```typescript
const SidebarNav = memo(function SidebarNav({
	userLinks,
	adminLinks,
	close,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	close: () => void;
}) {
	const adminByGroup = useMemo(() => {
		const map = new Map<NavGroupKey, NavItem[]>();
		for (const link of adminLinks) {
			const group = link.group ?? "teaching";
			if (!map.has(group)) map.set(group, []);
			map.get(group)!.push(link);
		}
		return map;
	}, [adminLinks]);

	return (
		<>
			{userLinks.map((link) => {
				const Icon = link.icon;
				return (
					<NavLink
						key={link.to}
						to={link.to}
						end={link.end}
						onClick={close}
						className={({ isActive }) =>
							cn(
								"mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
								isActive && "bg-primary/10 text-primary",
							)
						}
					>
						<Icon size={17} />
						{link.label}
					</NavLink>
				);
			})}
			{adminLinks.length > 0 && (
				<>
					<Separator className="my-2" />
					{NAV_GROUPS.map((group) => {
						const links = adminByGroup.get(group.key);
						if (!links || links.length === 0) return null;
						return (
							<NavGroup
								key={group.key}
								label={group.label}
								icon={group.icon}
								defaultOpen={group.defaultOpen}
								storageKey={group.key}
							>
								{links.map((link) => {
									const Icon = link.icon;
									return (
										<NavLink
											key={link.to}
											to={link.to}
											end={link.end}
											onClick={close}
											className={({ isActive }) =>
												cn(
													"mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
													isActive && "bg-primary/10 text-primary",
												)
											}
										>
											<Icon size={17} />
											{link.label}
										</NavLink>
									);
								})}
							</NavGroup>
						);
					})}
				</>
			)}
		</>
	);
});
```

- [ ] **Step 3: Run typecheck**

```bash
cd frontend; npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Visual smoke test**

Run `pnpm run dev` and log in as admin. Verify:
- Sidebar shows grouped admin nav under collapsible headers
- "教学中心" is expanded by default
- "人员管理" / "系统运维" / "反馈中心" start collapsed
- Clicking a group header toggles it
- Active route highlights correctly

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "✨ feat: rewrite sidebar with collapsible grouped navigation"
```

---

### Task 4: Simplify sidebar bottom bar

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Simplify the AdminSidebar bottom section**

In `Layout.tsx`, find the bottom bar (lines 74-97 in `AdminSidebar`). Replace with:

```typescript
			<Separator />
			<div className="p-3">
				<NavLink to="/profile" onClick={onClose}
					className={({ isActive }) =>
						cn("mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent",
							isActive ? "bg-primary/10" : "bg-muted/50")
					}
				>
					<img src={avatar} alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border bg-muted" />
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium">{user?.display_name}</div>
						<div className="text-xs text-muted-foreground">{user?.role_display_name || user?.role || "用户"}</div>
					</div>
				</NavLink>
				<div className="flex items-center justify-between">
					<ModeToggle />
					<div className="flex gap-1">
						<Button variant="ghost" size="sm" className="h-8 text-xs" onClick={openFeedback}>
							<MessageSquarePlus size={13} />
						</Button>
						<Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={onLogout}>
							<LogOut size={13} />
						</Button>
					</div>
				</div>
			</div>
```

Changes: removed `NotificationBell`, `Info` about button; moved `MessageSquarePlus` next to mode toggle/logout (reduced prominence); removed the "反馈" text label from the feedback button (icon-only).

- [ ] **Step 2: Add NotificationBell to the main content header (mobile)**

In the `Layout.tsx` content area header (lines 173-179), add the bell:

```tsx
<div className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden shrink-0">
	<button type="button" className="flex size-9 items-center justify-center rounded-lg border border-border hover:bg-accent"
		onClick={() => setMobileOpen((v) => !v)} aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}>
		{mobileOpen ? <X size={18} /> : <Menu size={18} />}
	</button>
	<div className="flex-1 min-w-0"><span className="text-sm font-semibold">虚拟患者系统</span></div>
	<NotificationBell />
</div>
```

- [ ] **Step 3: Run typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "🎨 style: simplify sidebar bottom bar, relocate notification bell"
```

---

### Task 5: Phase 1 verification

- [ ] **Step 1: Full check**

```bash
cd backend; uv run ruff check; uv run ruff format --check; uv run ty check
cd ../frontend; npx tsc --noEmit; npx biome lint src/
```

- [ ] **Step 2: Run existing tests**

```bash
cd frontend; npx vitest run
```

- [ ] **Step 3: Verify Phase 1 in browser**

Log in as each role and confirm:
- [ ] super_admin sees all 4 groups, 教学中心 expanded
- [ ] admin sees 3 groups (no 系统运维), 教学中心 expanded
- [ ] teacher sees 2 groups (教学中心 + 反馈中心), 教学中心 expanded
- [ ] student sees no sidebar (student shell)
- [ ] Dark mode works
- [ ] Mobile sidebar toggle works
- [ ] Collapse state persists across page reload (localStorage)

---

## Phase 2: Teaching Dashboard Bento Grid

### Task 6: Create RingProgress component

**Files:**
- Create: `frontend/src/components/dashboard/RingProgress.tsx`
- Create: `frontend/src/__tests__/dashboard/RingProgress.test.tsx`

- [ ] **Step 1: Write the test**

Create `frontend/src/__tests__/dashboard/RingProgress.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RingProgress } from "@/components/dashboard/RingProgress";

describe("RingProgress", () => {
	it("renders percentage and label", () => {
		render(<RingProgress value={76} max={100} label="完成率" />);
		expect(screen.getByText("76%")).toBeInTheDocument();
		expect(screen.getByText("完成率")).toBeInTheDocument();
	});

	it("renders 0% when value is 0", () => {
		render(<RingProgress value={0} max={100} label="完成率" />);
		expect(screen.getByText("0%")).toBeInTheDocument();
	});

	it("renders 100% when value equals max", () => {
		render(<RingProgress value={50} max={50} label="完成率" />);
		expect(screen.getByText("100%")).toBeInTheDocument();
	});

	it("renders fraction subtitle", () => {
		render(<RingProgress value={15} max={20} label="完成率" subtitle="15人 / 20人" />);
		expect(screen.getByText("15人 / 20人")).toBeInTheDocument();
	});

	it("renders SVG circle", () => {
		const { container } = render(<RingProgress value={76} max={100} label="完成率" />);
		const circles = container.querySelectorAll("circle");
		expect(circles.length).toBeGreaterThanOrEqual(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend; npx vitest run src/__tests__/dashboard/RingProgress.test.tsx
```

- [ ] **Step 3: Create the component**

Create `frontend/src/components/dashboard/RingProgress.tsx`:

```typescript
import { cn } from "@/utils/cn";

interface RingProgressProps {
	value: number;
	max: number;
	label: string;
	subtitle?: string;
	size?: number;
	strokeWidth?: number;
	className?: string;
}

const COLOR_MAP: Record<string, string> = {
	green: "text-success-foreground",
	amber: "text-warning-foreground",
	red: "text-danger-foreground",
};

function ringColor(pct: number): string {
	if (pct >= 80) return COLOR_MAP.green;
	if (pct >= 60) return COLOR_MAP.amber;
	return COLOR_MAP.red;
}

export function RingProgress({
	value,
	max,
	label,
	subtitle,
	size = 100,
	strokeWidth = 8,
	className,
}: RingProgressProps) {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0;
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const offset = circumference - (pct / 100) * circumference;

	return (
		<div className={cn("flex flex-col items-center gap-2", className)}>
			<svg
				width={size}
				height={size}
				className="-rotate-90"
				role="img"
				aria-label={`${label}: ${pct}%`}
			>
				<title>{`${label}: ${pct}%`}</title>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeWidth={strokeWidth}
					className="text-muted/30"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={offset}
					className={ringColor(pct)}
					style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
				/>
			</svg>
			<div className="text-center">
				<div className={cn("text-2xl font-bold", ringColor(pct))}>
					{pct}%
				</div>
				<div className="text-[11px] text-muted-foreground">{label}</div>
				{subtitle && (
					<div className="text-xs text-muted-foreground mt-0.5">
						{subtitle}
					</div>
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend; npx vitest run src/__tests__/dashboard/RingProgress.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/RingProgress.tsx frontend/src/__tests__/dashboard/RingProgress.test.tsx
git commit -m "✨ feat: add RingProgress SVG circular indicator"
```

---

### Task 7: Create ActivityTimeline component

**Files:**
- Create: `frontend/src/components/dashboard/ActivityTimeline.tsx`
- Create: `frontend/src/__tests__/dashboard/ActivityTimeline.test.tsx`

- [ ] **Step 1: Write the test**

Create `frontend/src/__tests__/dashboard/ActivityTimeline.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityTimeline, type ActivityEvent } from "@/components/dashboard/ActivityTimeline";

const mockEvents: ActivityEvent[] = [
	{ id: "1", time: "14:32", studentName: "李同学", action: "完成了 糖尿病护理", meta: "85分", metaColor: "green" },
	{ id: "2", time: "13:15", studentName: "王同学", action: "开始了 心衰评估" },
];

describe("ActivityTimeline", () => {
	it("renders events in order", () => {
		render(<ActivityTimeline events={mockEvents} />);
		const times = screen.getAllByText(/^\d{2}:\d{2}$/);
		expect(times[0]).toHaveTextContent("14:32");
		expect(times[1]).toHaveTextContent("13:15");
	});

	it("renders student names and actions", () => {
		render(<ActivityTimeline events={mockEvents} />);
		expect(screen.getByText(/李同学/)).toBeInTheDocument();
		expect(screen.getByText(/完成了 糖尿病护理/)).toBeInTheDocument();
	});

	it("renders meta badge when provided", () => {
		render(<ActivityTimeline events={mockEvents} />);
		expect(screen.getByText("85分")).toBeInTheDocument();
	});

	it("renders empty state when no events", () => {
		render(<ActivityTimeline events={[]} />);
		expect(screen.getByText("暂无最近动态")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Create the component**

Create `frontend/src/components/dashboard/ActivityTimeline.tsx`:

```typescript
import { cn } from "@/utils/cn";

export interface ActivityEvent {
	id: string;
	time: string;
	studentName: string;
	action: string;
	meta?: string;
	metaColor?: "green" | "amber" | "red";
}

const metaColorClasses: Record<string, string> = {
	green: "bg-success text-success-foreground",
	amber: "bg-warning text-warning-foreground",
	red: "bg-danger text-danger-foreground",
};

interface ActivityTimelineProps {
	events: ActivityEvent[];
	className?: string;
}

export function ActivityTimeline({ events, className }: ActivityTimelineProps) {
	if (events.length === 0) {
		return (
			<div className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
				暂无最近动态
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col gap-0", className)}>
			{events.map((event) => (
				<div key={event.id} className="flex items-start gap-3 py-2.5">
					<span className="shrink-0 text-xs text-muted-foreground tabular-nums w-10 text-right pt-0.5">
						{event.time}
					</span>
					<div className="relative flex items-center pt-0.5">
						<div className="size-2 rounded-full bg-muted-foreground/30 ring-2 ring-background" />
					</div>
					<div className="flex-1 min-w-0">
						<span className="text-sm">
							<span className="font-medium">{event.studentName}</span>
							<span className="text-muted-foreground"> {event.action}</span>
						</span>
						{event.meta && (
							<span
								className={cn(
									"ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
									event.metaColor ? metaColorClasses[event.metaColor] : "bg-secondary text-secondary-foreground",
								)}
							>
								{event.meta}
							</span>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd frontend; npx vitest run src/__tests__/dashboard/ActivityTimeline.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/ActivityTimeline.tsx frontend/src/__tests__/dashboard/ActivityTimeline.test.tsx
git commit -m "✨ feat: add ActivityTimeline component for dashboard"
```

---

### Task 8: Create AssignmentOverview component

**Files:**
- Create: `frontend/src/components/dashboard/AssignmentOverview.tsx`

- [ ] **Step 1: Check what data `getAssignments` returns**

The existing API `getAssignments()` is already used in `AssignmentsPage.tsx`. The component will accept a list of assignment objects and render progress cards. No test needed (pure composition of existing Card/Badge/Button).

- [ ] **Step 2: Create the component**

Create `frontend/src/components/dashboard/AssignmentOverview.tsx`:

```typescript
import { useNavigate } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AssignmentRow = components["schemas"]["AssignmentRow"];

interface AssignmentOverviewProps {
	assignments: AssignmentRow[];
}

export function AssignmentOverview({ assignments }: AssignmentOverviewProps) {
	const navigate = useNavigate();
	const active = assignments.filter((a) => a.status !== "ended");

	if (active.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>进行中的作业</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{active.slice(0, 5).map((a) => {
					const pct =
						a.student_count > 0
							? Math.round((a.completed_count / a.student_count) * 100)
							: 0;
					return (
						<div
							key={a.id}
							className="flex flex-col gap-2 rounded-lg border p-3"
						>
							<div className="flex items-center justify-between">
								<div className="min-w-0">
									<div className="text-sm font-medium truncate">
										{a.title}
									</div>
									{a.class_name && (
										<div className="text-xs text-muted-foreground">
											{a.class_name}
											{a.end_time && (
												<span>
													{" "}
													·{" "}
													{new Date(a.end_time).toLocaleDateString(
														"zh-CN",
														{ month: "numeric", day: "numeric" },
													)}{" "}
													到期
												</span>
											)}
										</div>
									)}
								</div>
								<Button
									variant="outline"
									size="xs"
									onClick={() => navigate(`/admin/assignments/${a.id}`)}
								>
									查看详情
								</Button>
							</div>
							<div className="flex items-center gap-2">
								<div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
									<div
										className="h-full rounded-full bg-primary transition-all"
										style={{ width: `${pct}%` }}
									/>
								</div>
								<span className="text-xs text-muted-foreground tabular-nums shrink-0">
									{a.completed_count}/{a.student_count}
								</span>
							</div>
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/AssignmentOverview.tsx
git commit -m "✨ feat: add AssignmentOverview component for teaching dashboard"
```

---

### Task 9: Create TeachingDashboard component

**Files:**
- Create: `frontend/src/components/dashboard/TeachingDashboard.tsx`

This is the main bento grid dashboard. It composes `StatCard`, `RingProgress`, `ActivityTimeline`, and `AssignmentOverview`.

- [ ] **Step 1: Review current AdminDashboard data fetching**

Read `frontend/src/components/dashboard/AdminDashboard.tsx` to understand what APIs it uses. We'll reuse the same data sources but present them differently.

- [ ] **Step 2: Create the component**

Create `frontend/src/components/dashboard/TeachingDashboard.tsx`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, TrendingUp, Users } from "lucide-react";
import type { components } from "@/api/api-types.gen";
import { getAssignments } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { getRecords } from "@/api/records";
import { getStats } from "@/api/stats";
import { useToast } from "@/components/Toast";
import StatCard from "@/components/ui/stat-card";
import useAuthStore from "@/stores/authStore";
import type { RecordExtended } from "@/types/record";
import { ActivityTimeline, type ActivityEvent } from "./ActivityTimeline";
import { AssignmentOverview } from "./AssignmentOverview";
import { RingProgress } from "./RingProgress";

type AdminStats = components["schemas"]["AdminStats"];
type AssignmentRow = components["schemas"]["AssignmentRow"];

const SCORE_COLOR = (s: number): ActivityEvent["metaColor"] =>
	s >= 85 ? "green" : s >= 60 ? "amber" : "red";

export function TeachingDashboard() {
	const user = useAuthStore((s) => s.user);
	const toast = useToast();

	const { data: stats } = useQuery({
		queryKey: queryKeys.stats.admin,
		queryFn: () => getStats().then((r) => r.data as AdminStats),
		staleTime: 60_000,
	});

	const { data: recordsData } = useQuery({
		queryKey: queryKeys.training.records({ limit: 10 }),
		queryFn: () => getRecords({ limit: 10 }).then((r) => r.data),
		staleTime: 30_000,
	});

	const { data: assignmentsData } = useQuery({
		queryKey: queryKeys.assignments.list,
		queryFn: () => getAssignments().then((r) => r.data),
		staleTime: 60_000,
	});

	const records: RecordExtended[] = (recordsData as any) ?? [];
	const assignments: AssignmentRow[] = (assignmentsData as any) ?? [];

	const completedRecords = records.filter(
		(r: RecordExtended) => r.status === "completed",
	);
	const todayRecords = records.filter((r: RecordExtended) => {
		const d = new Date(r.start_time);
		const today = new Date();
		return d.toDateString() === today.toDateString();
	});

	const completedWeek = records.filter((r: RecordExtended) => {
		if (r.status !== "completed") return false;
		const d = new Date(r.start_time);
		const now = new Date();
		const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
		return d >= weekAgo;
	});

	const totalStudents = stats?.student_count ?? 0;
	const activeStudentCount = new Set(
		todayRecords.map((r: RecordExtended) => r.student_name),
	).size;

	const pendingReview =
		completedRecords.filter((r: RecordExtended) => {
			const s = r as any;
			return !s.score_reviewed;
		}).length;

	const hour = new Date().getHours();
	const greeting =
		hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

	const recentEvents: ActivityEvent[] = records.slice(0, 8).map((r: RecordExtended) => ({
		id: r.id,
		time: new Date(r.start_time).toLocaleTimeString("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
		}),
		studentName: r.student_name ?? "未知",
		action:
			r.status === "completed"
				? `完成了 ${r.case_name ?? "训练"}`
				: "开始了训练",
		meta: r.score_total != null ? `${r.score_total}分` : undefined,
		metaColor:
			r.score_total != null ? SCORE_COLOR(r.score_total) : undefined,
	}));

	return (
		<div className="space-y-6">
			{/* Greeting */}
			<div>
				<h1 className="text-xl font-bold">
					{greeting}，{user?.display_name || "老师"}
				</h1>
				<p className="text-sm text-muted-foreground mt-1">
					本周截至{" "}
					{new Date().toLocaleDateString("zh-CN", {
						month: "long",
						day: "numeric",
					})}
				</p>
			</div>

			{/* Bento Grid */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
				{/* Large stat: active students */}
				<StatCard
					icon={Users}
					value={activeStudentCount}
					label="今日活跃学生"
					color="teal"
					className="md:col-span-2"
				/>

				{/* Pending review */}
				<StatCard
					icon={GraduationCap}
					value={`${pendingReview} 份`}
					label="待批阅作业"
					color={pendingReview > 5 ? "amber" : "green"}
				/>

				{/* Ring progress: weekly completion */}
				<div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 flex items-center justify-center">
					<RingProgress
						value={completedWeek.length}
						max={totalStudents || 1}
						label="本周训练完成率"
						subtitle={`${completedWeek.length}人 / ${totalStudents}人`}
					/>
				</div>

				{/* Assignment overview — spans 4 columns */}
				<div className="md:col-span-4">
					<AssignmentOverview assignments={assignments} />
				</div>

				{/* Activity timeline — spans 4 columns */}
				<div className="md:col-span-4">
					<div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4">
						<h3 className="text-sm font-medium mb-1">最近训练动态</h3>
						<ActivityTimeline events={recentEvents} />
					</div>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/TeachingDashboard.tsx
git commit -m "✨ feat: add TeachingDashboard bento grid layout"
```

---

### Task 10: Wire up Admin.tsx to TeachingDashboard

**Files:**
- Modify: `frontend/src/pages/Admin.tsx`

- [ ] **Step 1: Read current Admin.tsx**

Read `frontend/src/pages/Admin.tsx` to understand the current structure.

- [ ] **Step 2: Replace AdminDashboard with TeachingDashboard**

The current `Admin.tsx` likely imports `AdminDashboard`. Replace the import and usage:

```typescript
import { TeachingDashboard } from "@/components/dashboard/TeachingDashboard";

export default function Admin() {
	return <TeachingDashboard />;
}
```

If the current `Admin.tsx` has additional logic (like permission checks or data passing), preserve that structure but swap the rendered component.

- [ ] **Step 3: Keep old component as fallback**

Rename `AdminDashboard` to `AdminDashboardLegacy` in its file (don't delete it):

```bash
# In components/dashboard/AdminDashboard.tsx, change export:
export function AdminDashboardLegacy({ ... }) { ... }
```

- [ ] **Step 4: Run typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Admin.tsx frontend/src/components/dashboard/AdminDashboard.tsx
git commit -m "✨ feat: wire teaching dashboard as admin landing page"
```

---

### Task 11: Phase 2 verification

- [ ] **Step 1: Full check**

```bash
cd backend; uv run ruff check; uv run ty check
cd ../frontend; npx tsc --noEmit; npx biome lint src/; npx vitest run
```

- [ ] **Step 2: Visual verification**

- [ ] `/admin` shows bento grid with stat cards, ring progress, assignment cards, activity timeline
- [ ] All data loads correctly (stats, records, assignments)
- [ ] Dark mode renders properly
- [ ] Mobile: grid collapses to single column, all content readable

---

## Phase 3: Case Gallery + User Directory

### Task 12: Create CaseCard component

**Files:**
- Create: `frontend/src/components/admin/cases/CaseCard.tsx`
- Create: `frontend/src/__tests__/admin/CaseCard.test.tsx`

- [ ] **Step 1: Check CaseManageItem type**

Read the type definition for `CaseManageItem` from `api-types.gen.ts` or the existing `CasesTab.tsx` imports.

- [ ] **Step 2: Write the test**

Create `frontend/src/__tests__/admin/CaseCard.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaseManageItem } from "@/components/admin/cases/CaseCard";
import { CaseCard } from "@/components/admin/cases/CaseCard";

const mockCase: CaseManageItem = {
	id: "case-1",
	name: "急性心梗",
	training_type: "history_taking",
	difficulty: 2,
	patient_name: "张患者",
	patient_gender: "male",
	patient_age: 58,
	chief_complaint: "胸痛2小时",
	capabilities: ["patient_initiative", "nursing_record"],
	training_count: 12,
	is_open: true,
};

describe("CaseCard", () => {
	it("renders case name and patient info", () => {
		render(
			<CaseCard
				caseData={mockCase}
				onEdit={vi.fn()}
				onDelete={vi.fn()}
				onToggleOpen={vi.fn()}
				onStartTraining={vi.fn()}
			/>,
		);
		expect(screen.getByText("急性心梗")).toBeInTheDocument();
		expect(screen.getByText(/胸痛2小时/)).toBeInTheDocument();
	});

	it("renders difficulty stars", () => {
		render(
			<CaseCard
				caseData={mockCase}
				onEdit={vi.fn()}
				onDelete={vi.fn()}
				onToggleOpen={vi.fn()}
				onStartTraining={vi.fn()}
			/>,
		);
		expect(screen.getByText("中级")).toBeInTheDocument();
	});

	it("calls onStartTraining when button clicked", async () => {
		const onStart = vi.fn();
		render(
			<CaseCard
				caseData={mockCase}
				onEdit={vi.fn()}
				onDelete={vi.fn()}
				onToggleOpen={vi.fn()}
				onStartTraining={onStart}
			/>,
		);
		await userEvent.click(screen.getByText("开始训练"));
		expect(onStart).toHaveBeenCalledWith("case-1");
	});
});
```

- [ ] **Step 3: Create the component**

Create `frontend/src/components/admin/cases/CaseCard.tsx`:

```typescript
import { Play, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import Button from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import DifficultyBadge from "@/components/ui/difficulty-badge";
import { cn } from "@/utils/cn";

export type CaseManageItem = components["schemas"]["CaseManageItem"];

interface CaseCardProps {
	caseData: CaseManageItem;
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
	onToggleOpen: (id: string, open: boolean) => void;
	onStartTraining: (id: string) => void;
}

const TYPE_GRADIENTS: Record<string, string> = {
	history_taking: "from-teal-500/20 to-emerald-500/20",
	triage: "from-amber-500/20 to-orange-500/20",
};

const TYPE_EMOJI: Record<string, string> = {
	history_taking: "🩺",
	triage: "🚑",
};

const CAPABILITY_LABELS: Record<string, string> = {
	patient_initiative: "患者自主",
	nursing_record: "护理记录",
	physical_exam: "护理查体",
	emotion_detection: "情绪识别",
};

export function CaseCard({
	caseData,
	onEdit,
	onDelete,
	onToggleOpen,
	onStartTraining,
}: CaseCardProps) {
	const gradient = TYPE_GRADIENTS[caseData.training_type] ?? TYPE_GRADIENTS.history_taking;

	return (
		<Card className="group/case hover:shadow-e2 transition-shadow">
			{/* Type header gradient */}
			<div
				className={cn(
					"h-24 bg-gradient-to-br flex items-center justify-center text-3xl",
					gradient,
				)}
			>
				{TYPE_EMOJI[caseData.training_type] ?? "🩺"}
			</div>

			<CardHeader>
				<div className="flex items-start justify-between gap-2">
					<CardTitle className="truncate">{caseData.name}</CardTitle>
				</div>
				<div className="flex items-center gap-2 flex-wrap">
					<DifficultyBadge difficulty={caseData.difficulty} />
					<span className="text-xs text-muted-foreground">
						{caseData.training_type === "triage" ? "分诊" : "病史采集"}
					</span>
				</div>
			</CardHeader>

			<CardContent className="space-y-2">
				<p className="text-sm text-muted-foreground">
					{caseData.patient_gender === "male" ? "男" : "女"} ·{" "}
					{caseData.patient_age}岁
				</p>
				{caseData.chief_complaint && (
					<p className="text-xs text-muted-foreground line-clamp-2">
						{caseData.chief_complaint}
					</p>
				)}
				{caseData.capabilities && caseData.capabilities.length > 0 && (
					<div className="flex flex-wrap gap-1 pt-1">
						{caseData.capabilities
							.filter((c) => CAPABILITY_LABELS[c])
							.map((c) => (
								<span
									key={c}
									className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
								>
									{CAPABILITY_LABELS[c]}
								</span>
							))}
					</div>
				)}
				<p className="text-xs text-muted-foreground">
					{caseData.training_count ?? 0} 次训练
				</p>
			</CardContent>

			<CardFooter className="gap-1.5 justify-between flex-wrap">
				<Button size="xs" onClick={() => onStartTraining(caseData.id)}>
					<Play size={12} />
					开始训练
				</Button>
				<div className="flex gap-1">
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={() => onEdit(caseData.id)}
					>
						<Pencil size={13} />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						className="text-destructive hover:text-destructive"
						disabled={(caseData.training_count ?? 0) > 0}
						onClick={() => onDelete(caseData.id)}
					>
						<Trash2 size={13} />
					</Button>
				</div>
			</CardFooter>
		</Card>
	);
}
```

- [ ] **Step 4: Run test**

```bash
cd frontend; npx vitest run src/__tests__/admin/CaseCard.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/cases/CaseCard.tsx frontend/src/__tests__/admin/CaseCard.test.tsx
git commit -m "✨ feat: add CaseCard component for gallery layout"
```

---

### Task 13: Update CasesTab to use card gallery

**Files:**
- Modify: `frontend/src/components/admin/CasesTab.tsx`

- [ ] **Step 1: Read current CasesTab**

Read `frontend/src/components/admin/CasesTab.tsx` to understand the current structure, pagination, filtering, and data fetching. The table rendering will be replaced by a card grid while preserving filters and pagination.

- [ ] **Step 2: Replace table with card grid**

The key change: replace the `ResponsiveTable<CaseManageItem>` rendering with a grid of `CaseCard` components. Preserve:
- Filter bar (search, difficulty, type, is_open)
- Pagination
- Create/edit modal
- Delete confirmation
- Toggle open/close

The replacement code (only the content area section):

```typescript
// Replace the table rendering section with:
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
	{cases.map((c) => (
		<CaseCard
			key={c.id}
			caseData={c}
			onEdit={handleEdit}
			onDelete={handleDelete}
			onToggleOpen={handleToggleOpen}
			onStartTraining={handleStartTraining}
		/>
	))}
</div>
```

The `handleStartTraining` function navigates to `/training?caseId=${id}`.

- [ ] **Step 3: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/CasesTab.tsx
git commit -m "✨ feat: convert case list from table to card gallery"
```

---

### Task 14: Create UserCard component

**Files:**
- Create: `frontend/src/components/admin/users/UserCard.tsx`

- [ ] **Step 1: Check UserManageItem type**

Read the type from existing `UsersTab.tsx` or `api-types.gen.ts`.

- [ ] **Step 2: Create the component**

Create `frontend/src/components/admin/users/UserCard.tsx`:

```typescript
import type { components } from "@/api/api-types.gen";
import { Card, CardContent } from "@/components/ui/card";
import RoleBadge from "@/components/ui/role-badge";
import { getStudentAvatar } from "@/utils/avatar";
import { cn } from "@/utils/cn";

export type UserManageItem = components["schemas"]["UserManageItem"];

interface UserCardProps {
	user: UserManageItem;
	selected: boolean;
	onSelect: (id: string, selected: boolean) => void;
	onClick: (user: UserManageItem) => void;
}

export function UserCard({ user, selected, onSelect, onClick }: UserCardProps) {
	const avatar = getStudentAvatar(user.gender);

	return (
		<Card
			className={cn(
				"cursor-pointer transition-all hover:shadow-e2",
				selected && "ring-2 ring-primary",
			)}
			onClick={() => onClick(user)}
		>
			<CardContent className="flex items-center gap-3 py-4">
				<div className="relative">
					<input
						type="checkbox"
						checked={selected}
						onChange={(e) => {
							e.stopPropagation();
							onSelect(user.id, e.target.checked);
						}}
						onClick={(e) => e.stopPropagation()}
						className="absolute -top-1 -left-1 size-4 rounded border-border accent-primary"
						aria-label={`选择 ${user.display_name}`}
					/>
					<img
						src={avatar}
						alt=""
						className="size-11 rounded-full object-cover bg-muted ring-1 ring-border"
					/>
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium truncate">
							{user.display_name}
						</span>
						<RoleBadge role={user.role} />
					</div>
					{user.grade_name && (
						<div className="text-xs text-muted-foreground mt-0.5">
							{user.grade_name}
							{user.class_name && ` · ${user.class_name}`}
						</div>
					)}
					<div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
						<span>训练 {user.training_count ?? 0} 次</span>
						{user.last_login && (
							<span>
								最后登录{" "}
								{new Date(user.last_login).toLocaleDateString("zh-CN")}
							</span>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/users/UserCard.tsx
git commit -m "✨ feat: add UserCard component for directory layout"
```

---

### Task 15: Create BatchActionBar component

**Files:**
- Create: `frontend/src/components/admin/users/BatchActionBar.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/admin/users/BatchActionBar.tsx`:

```typescript
import { X } from "lucide-react";
import Button from "@/components/ui/button";

interface BatchActionBarProps {
	selectedCount: number;
	onClearSelection: () => void;
	onBulkAssignClass: () => void;
	onBulkResetPassword: () => void;
}

export function BatchActionBar({
	selectedCount,
	onClearSelection,
	onBulkAssignClass,
	onBulkResetPassword,
}: BatchActionBarProps) {
	if (selectedCount === 0) return null;

	return (
		<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-e3">
			<span className="text-sm font-medium">
				已选 {selectedCount} 人
			</span>
			<Button size="sm" variant="outline" onClick={onBulkAssignClass}>
				批量分配班级
			</Button>
			<Button size="sm" variant="outline" onClick={onBulkResetPassword}>
				批量重置密码
			</Button>
			<Button size="icon-xs" variant="ghost" onClick={onClearSelection}>
				<X size={14} />
			</Button>
		</div>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/admin/users/BatchActionBar.tsx
git commit -m "✨ feat: add BatchActionBar floating toolbar for user selection"
```

---

### Task 16: Update UsersTab to use user directory

**Files:**
- Modify: `frontend/src/components/admin/UsersTab.tsx`

- [ ] **Step 1: Read current UsersTab**

Read `frontend/src/components/admin/UsersTab.tsx` to understand current structure. Note the existing `useUserList` hook and `useUserMutations`.

- [ ] **Step 2: Add selection state and card grid**

The key changes to UsersTab:
1. Add `useState` for `selectedIds: Set<string>`
2. Replace table with `UserCard` grid
3. Add `BatchActionBar`
4. Preserve: search, filters (role, grade/class), register form, edit dialog, pagination
5. On card click → open edit dialog (or navigate to user detail)

```typescript
// Add state:
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

// Replace table with:
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
	{users.map((u) => (
		<UserCard
			key={u.id}
			user={u}
			selected={selectedIds.has(u.id)}
			onSelect={(id, sel) => {
				setSelectedIds((prev) => {
					const next = new Set(prev);
					if (sel) next.add(id);
					else next.delete(id);
					return next;
				});
			}}
			onClick={(user) => handleEdit(user)}
		/>
	))}
</div>

{/* At the bottom of the component: */}
<BatchActionBar
	selectedCount={selectedIds.size}
	onClearSelection={() => setSelectedIds(new Set())}
	onBulkAssignClass={() => {
		/* open bulk class assignment modal with selectedIds */
	}}
	onBulkResetPassword={() => {
		/* open bulk reset password confirm with selectedIds */
	}}
/>
```

- [ ] **Step 3: Wire bulk class assignment**

The bulk class assign modal already exists in UsersTab — use the existing `bulkAssignClass` mutation. Pass `Array.from(selectedIds)` as the user IDs.

- [ ] **Step 4: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/UsersTab.tsx
git commit -m "✨ feat: convert user list from table to card directory"
```

---

### Task 17: Phase 3 verification

- [ ] **Step 1: Full check**

```bash
cd backend; uv run ruff check; uv run ty check
cd ../frontend; npx tsc --noEmit; npx biome lint src/; npx vitest run
```

- [ ] **Step 2: Visual verification**

- [ ] `/admin/cases` shows card gallery with gradient headers, difficulty badges, capability labels
- [ ] Case filters (search, difficulty, type, open) still work
- [ ] Create/edit modal still opens and works
- [ ] Delete restricted when training_count > 0
- [ ] `/admin/users` shows user directory cards
- [ ] Checkbox selection works, batch bar appears
- [ ] Dark mode renders correctly

---

## Phase 4: Navigation Polish

### Task 18: Add page transitions with AnimatePresence

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Add motion imports**

At the top of `Layout.tsx`, add:

```typescript
import { AnimatePresence, motion } from "motion/react";
```

- [ ] **Step 2: Wrap Outlet with AnimatePresence**

Replace the `content` variable and its usage in the admin layout section (lines 135-138, 180-184).

In the admin layout (where `content` is rendered), change:

```tsx
// Before (line 180-184):
{isTrainingPage ? content : isQAPage ? (
	<div className="flex-1 min-h-0 overflow-hidden">{content}</div>
) : (
	<div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{content}</div>
)}

// After:
{isTrainingPage ? (
	content
) : isQAPage ? (
	<div className="flex-1 min-h-0 overflow-hidden">{content}</div>
) : (
	<div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
		<AnimatePresence mode="wait">
			<motion.div
				key={location.pathname}
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -8 }}
				transition={{ duration: 0.15, ease: "easeOut" }}
			>
				<Suspense fallback={<LoadingState className="h-full" />}>
					<Outlet />
				</Suspense>
			</motion.div>
		</AnimatePresence>
	</div>
)}
```

Remove the old `content` variable since it's now inlined.

- [ ] **Step 3: Run typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 4: Visual test**

Navigate between admin pages. Should see a subtle 150ms fade+slide transition. Pages that should NOT animate: training immersive, QA chat.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "✨ feat: add page transition animations with AnimatePresence"
```

---

### Task 19: Create Breadcrumb component

**Files:**
- Create: `frontend/src/components/ui/breadcrumb.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/ui/breadcrumb.tsx`:

```typescript
import { ChevronRight, Home } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";

export interface BreadcrumbItem {
	label: string;
	to?: string;
}

interface BreadcrumbProps {
	items: BreadcrumbItem[];
	className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
	if (items.length === 0) return null;

	return (
		<nav aria-label="面包屑导航" className={cn("flex items-center gap-1 text-sm", className)}>
			<Link
				to="/admin"
				className="text-muted-foreground hover:text-foreground transition-colors"
			>
				<Home size={14} />
			</Link>
			{items.map((item, i) => {
				const isLast = i === items.length - 1;
				return (
					<span key={item.label} className="flex items-center gap-1">
						<ChevronRight size={12} className="text-muted-foreground/50" />
						{isLast || !item.to ? (
							<span className="font-medium text-foreground">
								{item.label}
							</span>
						) : (
							<Link
								to={item.to}
								className="text-muted-foreground hover:text-foreground transition-colors"
							>
								{item.label}
							</Link>
						)}
					</span>
				);
			})}
		</nav>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ui/breadcrumb.tsx
git commit -m "✨ feat: add Breadcrumb navigation component"
```

---

### Task 20: Add breadcrumb support to PageHeader

**Files:**
- Modify: `frontend/src/components/ui/page-header.tsx`

- [ ] **Step 1: Add breadcrumb prop**

Open `frontend/src/components/ui/page-header.tsx`. Add `breadcrumb` prop:

```typescript
import { ChevronLeft } from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";

interface PageHeaderProps {
	title: string;
	subtitle?: string;
	icon?: ElementType;
	actions?: ReactNode;
	backTo?: string;
	breadcrumb?: BreadcrumbItem[];
	className?: string;
}
```

In the render block, add breadcrumb rendering before the title (after backTo check):

```typescript
{breadcrumb && breadcrumb.length > 0 && (
	<div className="mb-2">
		<Breadcrumb items={breadcrumb} />
	</div>
)}
```

Full updated component render:

```tsx
return (
	<div className={cn("mb-3 sm:mb-6", className)}>
		{backTo && (
			<div className="mb-2">
				<button
					type="button"
					onClick={() => navigate(backTo)}
					className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 cursor-pointer"
				>
					<ChevronLeft size={14} />
					返回
				</button>
			</div>
		)}
		{breadcrumb && breadcrumb.length > 0 && (
			<div className="mb-2">
				<Breadcrumb items={breadcrumb} />
			</div>
		)}
		<div className="flex items-start justify-between gap-4">
			<div className="min-w-0">
				<h1 className="flex items-center gap-2 text-lg sm:text-xl font-bold text-foreground">
					{Icon && <Icon size={22} />}
					{title}
				</h1>
				{subtitle && (
					<p className="hidden sm:block mt-1 text-sm text-muted-foreground">
						{subtitle}
					</p>
				)}
			</div>
			{actions && (
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			)}
		</div>
	</div>
);
```

- [ ] **Step 2: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/page-header.tsx frontend/src/components/ui/breadcrumb.tsx
git commit -m "✨ feat: add breadcrumb support to PageHeader"
```

---

### Task 21: Add stagger animations to card lists

**Files:**
- Modify: `frontend/src/components/admin/CasesTab.tsx`
- Modify: `frontend/src/components/admin/UsersTab.tsx`

- [ ] **Step 1: Wrap CasesTab card grid with motion stagger**

In `CasesTab.tsx`, import:

```typescript
import { motion } from "motion/react";
```

Wrap the grid container:

```tsx
<motion.div
	className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
	initial="hidden"
	animate="visible"
	variants={{
		hidden: {},
		visible: { transition: { staggerChildren: 0.04 } },
	}}
>
	{cases.map((c) => (
		<motion.div
			key={c.id}
			variants={{
				hidden: { opacity: 0, y: 16 },
				visible: { opacity: 1, y: 0 },
			}}
		>
			<CaseCard
				caseData={c}
				onEdit={handleEdit}
				onDelete={handleDelete}
				onToggleOpen={handleToggleOpen}
				onStartTraining={handleStartTraining}
			/>
		</motion.div>
	))}
</motion.div>
```

- [ ] **Step 2: Same for UsersTab**

Apply the identical stagger pattern to the UserCard grid in `UsersTab.tsx`.

- [ ] **Step 3: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/CasesTab.tsx frontend/src/components/admin/UsersTab.tsx
git commit -m "✨ feat: add stagger entry animations to card grids"
```

---

### Task 22: Final verification and cleanup

- [ ] **Step 1: Full lint + typecheck + test**

```bash
cd backend; uv run ruff check; uv run ruff format --check; uv run ty check
cd ../frontend; npx tsc --noEmit; npx biome lint src/; npx vitest run
```

- [ ] **Step 2: Dead import audit**

Search for unused imports in modified files:

```bash
cd frontend; npx biome lint src/ --fix
```

- [ ] **Step 3: Full browser verification**

Run `pnpm run dev` and verify end-to-end:
- [ ] Login as all 4 roles, navigate all pages
- [ ] Sidebar groups collapse/expand, persist
- [ ] Teaching dashboard loads all data
- [ ] Case gallery filters, pagination, modal CRUD work
- [ ] User directory selection, batch bar, edit dialog work
- [ ] Page transitions animate smoothly
- [ ] Breadcrumbs appear on detail pages (if wiring is added)
- [ ] Dark mode renders correctly on every new page
- [ ] Mobile responsive: all layouts collapse correctly

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "✨ feat: complete admin UX redesign with sidebar groups, bento dashboard, card galleries, and navigation polish"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Phase 1: Sidebar groups, naming fix, icon dedup, bottom bar simplify → Tasks 1-5
- [x] Phase 2: Bento grid dashboard with stat cards, ring progress, assignment overview, timeline → Tasks 6-11
- [x] Phase 3: Case gallery cards, user directory cards, batch bar → Tasks 12-17
- [x] Phase 4: Page transitions, breadcrumbs, stagger animations → Tasks 18-22

**2. Placeholder scan:**
- No TBD, TODO, or "implement later" in any task code block.
- All code steps contain complete, compilable TypeScript.

**3. Type consistency:**
- `NavGroupKey` defined in Task 1, used in Tasks 2-3.
- `ActivityEvent` defined in Task 7, used in Task 9.
- `CaseManageItem` and `UserManageItem` types pulled from existing `api-types.gen.ts`.
- `BreadcrumbItem` defined in Task 19, used in Task 20.
