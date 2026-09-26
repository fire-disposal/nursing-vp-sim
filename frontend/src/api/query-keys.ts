export const queryKeys = {
	cases: {
		all: ["cases"] as const,
		lists: () => [...queryKeys.cases.all, "list"] as const,
		list: (params: Record<string, unknown>) =>
			[...queryKeys.cases.lists(), params] as const,
		managed: {
			all: ["cases", "manage"] as const,
			list: (params: Record<string, unknown>) =>
				[...queryKeys.cases.managed.all, params] as const,
			validation: (id: number | string) =>
				[...queryKeys.cases.managed.all, "validation", String(id)] as const,
			revisions: (id: number | string) =>
				[...queryKeys.cases.managed.all, "revisions", String(id)] as const,
		},
		student: () => [...queryKeys.cases.all, "student"] as const,
	},
	training: {
		all: ["training"] as const,
		records: (params: Record<string, unknown>) =>
			[...queryKeys.training.all, "records", params] as const,
		detail: (id: number | string | null | undefined) =>
			[...queryKeys.training.all, "detail", String(id ?? "")] as const,
	},
	systemNotifications: {
		all: ["system-notifications"] as const,
	},
	notifications: {
		all: ["notifications"] as const,
		list: (params: Record<string, unknown> | null | undefined) =>
			["notifications", params] as const,
		recent: () => [...queryKeys.notifications.all, "recent"] as const,
		/** 未读总数（徽标专用，独立于列表分页） */
		unread: () => [...queryKeys.notifications.all, "unread"] as const,
	},
	diagnose: ["admin", "diagnose"] as const,
	voice: {
		config: ["admin", "voice", "config"] as const,
		usage: ["admin", "voice", "usage"] as const,
	},
	cost: {
		dashboard: ["admin", "cost", "dashboard"] as const,
		costExport: (
			startDate: string | null | undefined,
			endDate: string | null | undefined,
			service: string | null | undefined,
			granularity: string | null | undefined,
			format: string | null | undefined,
		) => ["admin", "cost", "export", startDate, endDate, service, granularity, format] as const,
		users: ["admin", "cost", "users"] as const,
	},
	qa: {
		all: ["qa"] as const,
		sessions: () => [...queryKeys.qa.all, "sessions"] as const,
	},
	stats: {
		all: ["stats"] as const,
		trends: (period: string) =>
			[...queryKeys.stats.all, "trends", period] as const,
		teacherSummary: (params: Record<string, unknown>) =>
			[...queryKeys.stats.all, "teacherSummary", params] as const,
		ranking: (params: Record<string, unknown>) =>
			[...queryKeys.stats.all, "ranking", params] as const,
		admin: () => [...queryKeys.stats.all, "admin"] as const,
	},
	admin: {
		auditLogs: {
			all: ["admin", "audit-logs"] as const,
			list: (params: Record<string, unknown>) => [...["admin", "audit-logs"], params] as const,
		},
		users: {
			all: ["admin", "users"] as const,
			list: (params: Record<string, unknown>) =>
				[...queryKeys.admin.users.all, params] as const,
			detail: (userId: number | string) =>
				[...queryKeys.admin.users.all, "detail", userId] as const,
			studentDetail: (userId: number | string | null | undefined) =>
				["admin", "users", "studentDetail", userId] as const,
		},
		roles: ["admin", "roles"] as const,
		feedback: {
			all: ["admin", "feedback"] as const,
			list: (params: Record<string, unknown>) =>
				[...queryKeys.admin.feedback.all, params] as const,
			stats: (params: Record<string, unknown>) =>
				[...queryKeys.admin.feedback.all, "stats", params] as const,
			my: (params: Record<string, unknown>) => ["my-feedback", params] as const,
		},
		llm: {
			all: ["admin", "llm"] as const,
			stats: () => [...queryKeys.admin.llm.all, "stats"] as const,
			logs: (params: Record<string, unknown>) =>
				[...queryKeys.admin.llm.all, "logs", params] as const,
		},
	},
	classes: {
		all: ["classes"] as const,
		list: (cohortLabel?: string | null) =>
			[...queryKeys.classes.all, "list", cohortLabel ?? null] as const,
		detail: (classId: number | string) =>
			[...queryKeys.classes.all, "detail", classId] as const,
		members: (classId: number | string, params: Record<string, unknown>) =>
			[...queryKeys.classes.all, "members", classId, params] as const,
		summary: (classId: number | string) =>
			[...queryKeys.classes.all, "summary", classId] as const,
	},
	rubric: {
		all: ["rubrics"] as const,
		current: () => [...queryKeys.rubric.all, "current"] as const,
	},
	apiManagement: {
		secrets: ["admin", "api", "secrets"] as const,
		fallback: ["admin", "api", "fallback"] as const,
	},
	questionnaires: {
		all: ["questionnaires"] as const,
		templates: (params: Record<string, unknown>) =>
			[...queryKeys.questionnaires.all, "templates", params] as const,
		detail: (id: number | null | undefined) =>
			[...queryKeys.questionnaires.all, "detail", id] as const,
		stats: (templateId: number | null | undefined) =>
			[...queryKeys.questionnaires.all, "stats", templateId] as const,
	},
	assignments: {
		all: ["assignments"] as const,
		list: (params?: Record<string, unknown>) =>
			[...queryKeys.assignments.all, params] as const,
		admin: () => [...queryKeys.assignments.all, "admin"] as const,
		detail: (id: string | null | undefined) => [...queryKeys.assignments.all, "detail", id] as const,
		student: () => [...queryKeys.assignments.all, "student"] as const,
	},
	scoreboard: {
		all: ["scoreboard"] as const,
		ranking: (params: Record<string, unknown>) =>
			[...queryKeys.scoreboard.all, "ranking", params] as const,
		trend: (userId: number | null | undefined, params: Record<string, unknown>) =>
			[...queryKeys.scoreboard.all, "trend", userId, params] as const,
	},
	versions: {
		all: ["admin", "versions"] as const,
		attribution: (by: string, windowDays: number) =>
			[...queryKeys.versions.all, "attribution", by, windowDays] as const,
	},
	llmCallLogs: {
		timeline: (recordId: number | null | undefined) => ["recordLogs", recordId] as const,
		detail: (logId: number | null | undefined) => ["logDetail", logId] as const,
	},
} as const;
