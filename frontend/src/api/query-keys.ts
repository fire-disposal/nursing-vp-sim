export const queryKeys = {
	auth: {
		me: ["auth", "me"] as const,
	},
	cases: {
		all: ["cases"] as const,
		lists: () => [...queryKeys.cases.all, "list"] as const,
		list: (params: Record<string, unknown>) =>
			[...queryKeys.cases.lists(), params] as const,
		details: () => [...queryKeys.cases.all, "detail"] as const,
		detail: (id: number | string) =>
			[...queryKeys.cases.details(), id] as const,
		managed: {
			all: ["cases", "manage"] as const,
			list: (params: Record<string, unknown>) =>
				[...queryKeys.cases.managed.all, params] as const,
		},
	},
	training: {
		all: ["training"] as const,
		records: (params: Record<string, unknown>) =>
			[...queryKeys.training.all, "records", params] as const,
		recent: () => [...queryKeys.training.all, "records", "recent"] as const,
		detail: (id: number | string) =>
			[...queryKeys.training.all, "detail", id] as const,
		review: (id: number | string) =>
			[...queryKeys.training.all, "review", id] as const,
		state: (recordId: number) =>
			[...queryKeys.training.all, "state", recordId] as const,
	},
	qa: {
		all: ["qa"] as const,
		sessions: () => [...queryKeys.qa.all, "sessions"] as const,
		history: (params: Record<string, unknown>) =>
			[...queryKeys.qa.all, "history", params] as const,
		messages: (sessionId: number | string) =>
			[...queryKeys.qa.all, "messages", sessionId] as const,
	},
	stats: {
		all: ["stats"] as const,
		duration: (period: string) =>
			[...queryKeys.stats.all, "duration", period] as const,
		trends: (period: string) =>
			[...queryKeys.stats.all, "trends", period] as const,
		teacherSummary: (params: Record<string, unknown>) =>
			[...queryKeys.stats.all, "teacherSummary", params] as const,
		ranking: (params: Record<string, unknown>) =>
			[...queryKeys.stats.all, "ranking", params] as const,
		classSummary: (params: Record<string, unknown>) =>
			[...queryKeys.stats.all, "classSummary", params] as const,
		admin: () => [...queryKeys.stats.all, "admin"] as const,
	},
	admin: {
		schools: {
			all: ["admin", "schools"] as const,
			list: (search: string, offset: number) =>
				["admin", "schools", search, offset] as const,
		},
		users: {
			all: ["admin", "users"] as const,
			list: (params: Record<string, unknown>) =>
				[...queryKeys.admin.users.all, params] as const,
			detail: (userId: number | string) =>
				[...queryKeys.admin.users.all, "detail", userId] as const,
		},
		roles: ["admin", "roles"] as const,
		feedback: {
			all: ["admin", "feedback"] as const,
			list: (params: Record<string, unknown>) =>
				[...queryKeys.admin.feedback.all, params] as const,
			stats: (params: Record<string, unknown>) =>
				[...queryKeys.admin.feedback.all, "stats", params] as const,
		},
		llm: {
			all: ["admin", "llm"] as const,
			stats: () => [...queryKeys.admin.llm.all, "stats"] as const,
			logs: (params: Record<string, unknown>) =>
				[...queryKeys.admin.llm.all, "logs", params] as const,
		},
	},
	grades: {
		all: ["grades"] as const,
		classes: (gradeId?: number) =>
			[...queryKeys.grades.all, "classes", gradeId] as const,
	},
	rubric: {
		all: ["rubrics"] as const,
		active: () => [...queryKeys.rubric.all, "active"] as const,
	},
	apiManagement: {
		all: ["admin", "api"] as const,
		secrets: ["admin", "api", "secrets"] as const,
		configs: (purpose?: string) =>
			["admin", "api", "configs", purpose] as const,
		modelPresets: ["admin", "api", "modelPresets"] as const,
		health: ["admin", "api", "health"] as const,
		fallback: ["admin", "api", "fallback"] as const,
	},
	prompts: {
		list: ["prompts"] as const,
		byPurpose: (purpose?: string) => ["prompts", purpose] as const,
		activePreview: (purpose: string) =>
			["prompts", "active", "preview", purpose] as const,
		sampleVars: (purpose: string) =>
			["prompts", "sampleVars", purpose] as const,
	},
	questionnaires: {
		all: ["questionnaires"] as const,
		templates: (offset: number, typeFilter?: string) =>
			[
				...queryKeys.questionnaires.all,
				"templates",
				offset,
				typeFilter,
			] as const,
		detail: (id: number | null) =>
			[...queryKeys.questionnaires.all, "detail", id] as const,
		stats: (templateId: number | null) =>
			[...queryKeys.questionnaires.all, "stats", templateId] as const,
		responses: (templateId: number, params?: Record<string, unknown>) =>
			[
				...queryKeys.questionnaires.all,
				"responses",
				templateId,
				params,
			] as const,
		check: (params: {
			case_id?: number;
			record_id?: number;
			trigger?: string;
		}) => [...queryKeys.questionnaires.all, "check", params] as const,
		myResponses: (params?: Record<string, unknown>) =>
			[...queryKeys.questionnaires.all, "myResponses", params] as const,
	},
	practices: {
		all: ["practices"] as const,
	},
	sessionConfigs: ["sessionConfigs"] as const,
	nursingRecord: (recordId: number) => ["nursingRecord", recordId] as const,
	assignments: {
		all: ["assignments"] as const,
		list: (params?: Record<string, unknown>) =>
			[...queryKeys.assignments.all, params] as const,
		detail: (id: string) => ["assignments", "detail", id] as const,
		student: ["student-assignments"] as const,
	},
	llmCallLogs: {
		timeline: (recordId: number) => ["recordLogs", recordId] as const,
		detail: (logId: number | null) => ["logDetail", logId] as const,
	},
} as const;
