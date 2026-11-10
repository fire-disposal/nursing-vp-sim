import { api } from "@/api/client";


export interface FrontendErrorEntry {
	time: string;
	first_seen?: string;
	fingerprint?: string;
	type: string;
	message: string;
	url: string;
	user_id: number;
	count: number;
	source?: string;
	component_stack?: string;
	/** 出事端浏览器 UA（跨 worker 归档携带，用于区分机房旧浏览器等环境差异）。 */
	ua?: string;
}

export interface ErrorCount {
	last_5min: number;
	last_hour: number;
	/** 24h 内不同错误签名数（与 unique_24h 同义，历史键名）。 */
	total_captured: number;
	unique_24h: number;
}
export interface FrontendErrors {
	scope: "workers";
	window: string;
	window_by_count: Record<string, string>;
	count: ErrorCount;
	groups: FrontendErrorEntry[];
}

export interface RequestHotspot {
	route: string;
	status: number;
	count: number;
}

/**
 * 后端错误分组（`get_error_context().groups[]` 的形状）。
 *
 * `message` 是最近一条消息，`messages` 是同指纹的变体（去重、上限 5 条，
 * 无该字段时说明数据源只给了 `recent` 行，不补造）。
 */
export interface BackendErrorGroup {
	fingerprint: string;
	level: string;
	logger: string;
	message: string;
	messages?: string[];
	count: number;
	first_seen: string;
	last_seen: string;
	/** 仅档案事件带（`memory` = 本进程未落盘行）。 */
	source?: string;
	/** 仅档案事件带（发生时的后端版本）。 */
	version?: string;
}

export interface RequestMetrics {
	total?: number;
	by_status?: Record<string, number>;
	by_status_code?: Record<string, number>;
	top_4xx?: RequestHotspot[];
	top_5xx?: RequestHotspot[];
	latency_ms?: { p50?: number; p95?: number; p99?: number; avg?: number };
}
export interface DiagnoseResponse {
	llm: {
		total_calls_24h: number;
		success_rate: number;
		error_count_24h: number;
		avg_latency_ms: number;
		recent_errors: { type: string; count: number }[];
	};
	scoring: {
		pending: number;
		in_progress: number;
		completed_24h: number;
		failed_24h: number;
		success_rate: number;
	};
	/** 持久化 Job 队列（`SCORING_EXECUTION=job` 时评分的执行路径）。 */
	jobs?: {
		scope: "db";
		window: string;
		/** kind → status → 计数（只出现库里存在过的组合）。 */
		by_kind: Record<string, Record<string, number>>;
		/** 最老 pending 作业已等待秒数；持续抬头=消费者跟不上。 */
		oldest_pending_seconds: number;
		/** running 且租约已过期（执行者消失、等待重领）的条数。 */
		expired_leases: number;
	};
	voice: {
		tts: { calls_24h: number; success_rate: number; error_count_24h: number; avg_latency_ms: number; cost_24h: number };
	};
	voice_budget: { monthly_budget: number; monthly_cost: number; usage_pct: number };
	business: { today_users: number; today_trainings: number; today_completed: number };
	/** 未回复反馈概览 —— 只含计数与最老一条的时间，不含正文/用户标识。 */
	feedback?: {
		scope: "db";
		window: string;
		unanswered: number;
		oldest_created_at: string | null;
		oldest_age_days: number | null;
	};
	metrics: Record<string, unknown> & { requests?: RequestMetrics; version?: string; active_sessions?: number; uptime_seconds?: number };
	errors: {
		scope: "workers";
		/** 块自带的滚动窗口标签（`rolling_60m`）；计数键窗口见 `window_by_count`。 */
		window?: string;
		window_by_count: Record<string, string>;
		count: ErrorCount;
		/**
		 * 最近错误行（档案 + 未落盘增量，非分组投影）；`fingerprint` 由服务端给出。
		 *
		 * 分组在 `errors.groups`（`get_error_context()` 的投影，字段见 `BackendErrorGroup`）。
		 * `groups` 为可选以兼容旧快照：缺失时由 `recent` 行按**服务端** `fingerprint`
		 * 聚合成同形分组；缺指纹的行不参与（前端不复制指纹算法）。
		 */
		recent: {
			time: string;
			level: string;
			logger: string;
			message: string;
			fingerprint?: string;
			source?: string;
			count?: number;
			first_seen?: string;
			last_seen?: string;
			version?: string;
		}[];
		groups?: BackendErrorGroup[];
		/** 完整查询窗口的事件总数 / 不同指纹数（`errors.groups` 被裁剪时仍描述全集）。 */
		total_events?: number;
		unique_groups?: number;
		/** `true` 表示 `groups` 只含裁剪后的代表错误。 */
		truncated?: boolean;
	};
	frontend_errors?: FrontendErrors;
	alerts: string[];
}

export const fetchDiagnose = () =>
	api.get<DiagnoseResponse>("/admin/ops/dashboard");

/* ────────────────────────── 错误组（下钻用） ────────────────────────── */

/** 指纹是服务端产物：这里只判断「服务端给了没有」，从不自行计算。 */
function hasFingerprint(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/**
 * 系统错误块 → 分组列表（页面与下钻共用的唯一归一化入口）。
 *
 * 优先取后端已分组的 `errors.groups`；只有 `recent` 行时按**服务端已带的**
 * `fingerprint` 聚合（`count` 求和、首末时间取极值）。缺指纹的行直接丢弃：
 * 前端不复制指纹算法，也不拿行序号之类的临时值充当下钻标识 —— 那样点进去
 * 必然查不到对应分组。
 */
export function resolveBackendGroups(errors: DiagnoseResponse["errors"] | undefined): BackendErrorGroup[] {
	if (!errors) return [];
	if (Array.isArray(errors.groups) && errors.groups.length > 0) {
		return errors.groups.filter((group) => hasFingerprint(group.fingerprint));
	}
	const byFingerprint = new Map<string, BackendErrorGroup>();
	for (const row of errors.recent ?? []) {
		if (!hasFingerprint(row.fingerprint)) continue;
		const at = row.time || row.last_seen || "";
		const first = row.first_seen || row.time || "";
		const existing = byFingerprint.get(row.fingerprint);
		if (!existing) {
			byFingerprint.set(row.fingerprint, {
				fingerprint: row.fingerprint,
				level: row.level ?? "",
				logger: row.logger ?? "",
				message: row.message ?? "",
				count: Math.max(row.count ?? 1, 1),
				first_seen: first,
				last_seen: at,
				source: row.source,
				version: row.version,
			});
			continue;
		}
		existing.count += Math.max(row.count ?? 1, 1);
		// ISO-8601 UTC 串可直接字典序比较；空串不参与取极值（不能把「未知」当成 1970）
		if (first && (!existing.first_seen || first < existing.first_seen)) {
			existing.first_seen = first;
		}
		if (at && at > existing.last_seen) {
			existing.last_seen = at;
			existing.message = row.message ?? "";
		}
	}
	return [...byFingerprint.values()].sort((a, b) => b.last_seen.localeCompare(a.last_seen));
}

/**
 * 前端遥测块 → 分组列表。只透传服务端给的 `fingerprint`；
 * 缺指纹的组没有稳定下钻标识，直接过滤掉（前端不重算哈希）。
 */
export function resolveFrontendGroups(
	frontendErrors: FrontendErrors | undefined,
): (FrontendErrorEntry & { fingerprint: string })[] {
	return (frontendErrors?.groups ?? []).filter(
		(group): group is FrontendErrorEntry & { fingerprint: string } =>
			hasFingerprint(group.fingerprint),
	);
}

/**
 * 解码路由里的指纹。地址栏是可控输入：`decodeURIComponent` 会抛，
 * 也可能带出路径分隔符 —— 两者都当作"地址无效"，不当成查询参数。
 */
export function normalizeFingerprint(raw: string | undefined): string | null {
	if (!raw) return null;
	let decoded = raw;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return null;
	}
	const value = decoded.trim();
	if (!value || value.length > 128 || /[/\\?#&]/.test(value)) return null;
	return value;
}

/** 两种错误组的最近发生时间（前端用 `time`，后端用 `last_seen`）。 */
export function groupLastSeen(group: BackendErrorGroup | FrontendErrorEntry): string {
	return "time" in group && group.time ? group.time : (group as BackendErrorGroup).last_seen ?? "";
}

