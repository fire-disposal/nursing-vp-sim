import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import {
	createSimulationSession,
	getSimulationSession,
	postSimulationAction,
} from "@/api/simulations";
import { computeCompletionGroups } from "./completions";
import type { CommandSurface } from "./commands";
import type { Completion } from "./commands";
import type { ParsedAction } from "./parser";
import { parseCommand } from "./parser";
import SimTimeline from "./SimTimeline";
import { buildTimelineModel } from "./timeline";
import "./console.css";

type SimulationSnapshot = components["schemas"]["SimulationSnapshot"];
type ActionCatalog = components["schemas"]["ActionCatalogOut"];
type ActionEntry = components["schemas"]["ActionEntry"];

/** 床旁最近生命体征（快照 latest_vitals 的已知字段视图）。 */
interface LatestVitals {
	hr: number;
	sbp: number;
	dbp: number;
	rr: number;
	spo2: number;
	temp: number;
	abnormal?: boolean;
}

const SESSION_KEY = "simulation.sessionId";

const EMPTY_CATALOG: ActionCatalog = { assess: [], order: [], give: [], talk: [], manage: [] };

// 分片化时间：墙钟 = 病例起始时钟 + 游戏分钟。起始时钟来自快照
// case_meta.start_clock（后端单一事实源），不再硬编码 08:30。
function clockText(minute: number, startClock = "08:30"): string {
	const [hh, mm] = startClock.split(":").map(Number);
	const total = hh * 60 + mm + minute;
	const h = Math.floor(total / 60) % 24;
	const m = total % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const KIND_LABEL: Record<string, string> = {
	SYSTEM: "SYSTEM",
	ASSESSMENT: "ASSESSMENT",
	MONITOR: "MONITOR",
	LAB: "LAB",
	TALK: "TALK",
	PATIENT: "患者",
	HINT: "教练",
	WARNING: "WARNING",
	CRITICAL: "CRITICAL",
	AUDIT: "AUDIT",
};

type ObjectiveKey = "assessed" | "evidence" | "monitoring" | "treated" | "reported" | "diagnosis";

const OBJECTIVE_LABEL: Record<ObjectiveKey, string> = {
	assessed: "评估",
	evidence: "异常证据",
	monitoring: "监护",
	treated: "治疗",
	reported: "报告",
	diagnosis: "诊断",
};

interface TranscriptItem {
	key: string;
	kind: "echo" | "msg";
	text: string;
	msgKind?: string;
	atMinute?: number;
}

/** 行动按钮 — 服务器驱动（snapshot.actions），点击即执行对应结构化动作。 */
function ActionButton({
	entry,
	onRun,
	doseOpen,
	onToggleDose,
	doseValue,
	onDoseChange,
	onConfirmDose,
	disabled,
}: {
	entry: ActionEntry;
	onRun: (e: ActionEntry) => void;
	doseOpen: boolean;
	onToggleDose: (id: string) => void;
	doseValue: number;
	onDoseChange: (id: string, v: number) => void;
	onConfirmDose: (e: ActionEntry) => void;
	disabled: boolean;
}) {
	const isDose = entry.default_dose != null;
	const open = doseOpen && isDose;
	const badge = [
		entry.duration != null ? `${entry.duration}min` : null,
		entry.turnaround != null ? `${entry.turnaround}min` : null,
		entry.cost_label ?? null,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<div className="sim-action-wrap">
			<button
				type="button"
				className={`sim-action-btn${entry.enabled && !disabled ? "" : " sim-action-disabled"}${open ? " sim-action-open" : ""}`}
				disabled={!entry.enabled || disabled}
				title={entry.disabled_reason ?? undefined}
				onClick={() => {
					if (isDose && !open) {
						onToggleDose(entry.id);
					} else if (open) {
						onConfirmDose(entry);
					} else {
						onRun(entry);
					}
				}}
			>
				<span className="sim-action-label">{entry.label}</span>
				{badge ? <span className="sim-action-badge">{badge}</span> : null}
			</button>
			{entry.disabled_reason ? (
				<span className="sim-action-reason">{entry.disabled_reason}</span>
			) : null}
			{open ? (
				<div className="sim-dose">
					<button
						type="button"
						className="sim-dose-btn"
						aria-label="减少剂量"
						onClick={() => onDoseChange(entry.id, doseValue - (entry.default_dose ?? 1))}
					>
						−
					</button>
					<span className="sim-dose-value">
						{doseValue}
						{entry.unit ? ` ${entry.unit}` : ""}
					</span>
					<button
						type="button"
						className="sim-dose-btn"
						aria-label="增加剂量"
						onClick={() => onDoseChange(entry.id, doseValue + (entry.default_dose ?? 1))}
					>
						+
					</button>
					<button type="button" className="sim-dose-confirm" onClick={() => onConfirmDose(entry)}>
						给药
					</button>
					<button type="button" className="sim-dose-cancel" onClick={() => onToggleDose(entry.id)}>
						取消
					</button>
				</div>
			) : null}
		</div>
	);
}

export default function SimulationConsole() {
	const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
	const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [panelDismissed, setPanelDismissed] = useState(false);
	const [history, setHistory] = useState<string[]>([]);
	const [selIndex, setSelIndex] = useState(-1);
	const [caseMenuOpen, setCaseMenuOpen] = useState(false);
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const [diagOpen, setDiagOpen] = useState(false);
	const [diagDraft, setDiagDraft] = useState("");
	const [briefOpen, setBriefOpen] = useState(true);
	const [hintDismissed, setHintDismissed] = useState("");
	const [doseOpen, setDoseOpen] = useState<string | null>(null);
	const [doseValue, setDoseValue] = useState<Record<string, number>>({});
	const diagSyncedRef = useRef(false);
	const historyIdxRef = useRef<number | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const seqRef = useRef(0);
	function push(text: string, msgKind = "SYSTEM") {
		setTranscript((t) => [
			...t,
			{ key: `m${++seqRef.current}`, kind: "msg", text, msgKind },
		]);
	}

	useEffect(() => {
		const stored = localStorage.getItem(SESSION_KEY);
		async function boot() {
			if (stored) {
				try {
					const snap = await getSimulationSession(Number(stored));
					setSnapshot(snap);
					setTranscript(
						snap.messages.map(
							(m): TranscriptItem => ({
								key: `m${++seqRef.current}`,
								kind: "msg",
								text: m.text,
								msgKind: m.kind,
								atMinute: m.at_minute,
							}),
						),
					);
					return;
				} catch {
					// Stored session gone — fall through to a fresh one.
				}
			}
			const r = await createSimulationSession();
			localStorage.setItem(SESSION_KEY, String(r.session_id));
			setSnapshot(r.snapshot);
			setTranscript(
				r.snapshot.messages.map(
					(m): TranscriptItem => ({
						key: `m${++seqRef.current}`,
						kind: "msg",
						text: m.text,
						msgKind: m.kind,
						atMinute: m.at_minute,
					}),
				),
			);
		}
		boot().catch(() => push("无法创建模拟会话（请确认已登录且后端已启动）。", "CRITICAL"));
	}, []);

	useEffect(() => {
		const el = listRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [transcript.length]);

	// 诊断草稿：后端 diagnosis 是单一事实源；仅在「已同步且值变化」时回填，
	// 避免覆盖用户正在编辑的文本。
	useEffect(() => {
		if (diagSyncedRef.current) return;
		if (snapshot?.diagnosis != null) {
			setDiagDraft(snapshot.diagnosis);
			diagSyncedRef.current = true;
		}
	}, [snapshot?.diagnosis]);
	const pendingCount = snapshot?.pending.length ?? 0;
	const caseEnded = snapshot != null && snapshot.case_status !== "ACTIVE";

	const groups = useMemo(
		() => computeCompletionGroups(input, snapshot?.surface as CommandSurface | undefined),
		[input, snapshot?.surface],
	);
	const panelVisible = groups.length > 0 && !panelDismissed;
	// Groups auto-open once a prefix is typed; bare "/" stays folded until clicked.
	const isOpen = (name: string) => expandedGroups.has(name) || input.trimStart().length > 1;
	const visibleItems = groups.flatMap((g) => (isOpen(g.name) ? g.items : []));

	function toggleGroup(name: string) {
		setExpandedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	}

	function applyCompletion(c: Completion) {
		setInput(c.text);
		setPanelDismissed(true);
		setSelIndex(-1);
		inputRef.current?.focus();
	}

	async function runParsed(parsed: ParsedAction) {
		if (!snapshot || busy) return;
		setHistory((h) => [...h, parsed.type.toLowerCase()]);
		historyIdxRef.current = null;
		setTranscript((t) => [...t, { key: `e${++seqRef.current}`, kind: "echo", text: echoText(parsed) }]);
		setInput("");
		setBusy(true);
		const sid = snapshot.session_id;
		try {
			const r = await postSimulationAction(sid, parsed);
			setSnapshot(r.snapshot);
			setTranscript((t) => [
				...t,
				...r.messages.map(
					(m): TranscriptItem => ({
						key: `m${++seqRef.current}`,
						kind: "msg",
						text: m.text,
						msgKind: m.kind,
						atMinute: m.at_minute,
					}),
				),
			]);
		} catch {
			push("动作提交失败，请重试。", "CRITICAL");
		} finally {
			setBusy(false);
			inputRef.current?.focus();
		}
	}

	/** 从结构化动作生成回显文本（行动面板点击时也在记录流里留痕）。 */
	function echoText(parsed: ParsedAction): string {
		const head = parsed.type.toLowerCase();
		if (parsed.target) return `/${head} ${parsed.target}`;
		if (parsed.text) return `/${head} ${parsed.text}`;
		return `/${head}`;
	}

	async function run(raw: string) {
		if (!snapshot) return;
		const parsed = parseCommand(raw);
		if ("error" in parsed) {
			setTranscript((t) => [
				...t,
				{ key: `e${++seqRef.current}`, kind: "echo", text: raw.trim() },
				{ key: `m${++seqRef.current}`, kind: "msg", text: parsed.error, msgKind: "WARNING" },
			]);
			return;
		}
		if (parsed.action.type === "CASE" && parsed.action.target) {
			// Switching case = opening a fresh session in the chosen case.
			setTranscript((t) => [
				...t,
				{ key: `e${++seqRef.current}`, kind: "echo", text: raw.trim() },
				{ key: `m${++seqRef.current}`, kind: "msg", text: `切换到病例 ${parsed.action.target}，开启新局…`, msgKind: "SYSTEM" },
			]);
			await newSession(parsed.action.target);
			return;
		}
		const trimmed = raw.trim();
		setHistory((h) => [...h, trimmed]);
		historyIdxRef.current = null;
		setTranscript((t) => [...t, { key: `e${++seqRef.current}`, kind: "echo", text: trimmed }]);
		setInput("");
		setBusy(true);
		const sid = snapshot.session_id;
		try {
			const r = await postSimulationAction(sid, parsed.action);
			setSnapshot(r.snapshot);
			setTranscript((t) => [
				...t,
				...r.messages.map(
					(m): TranscriptItem => ({
						key: `m${++seqRef.current}`,
						kind: "msg",
						text: m.text,
						msgKind: m.kind,
						atMinute: m.at_minute,
					}),
				),
			]);
		} catch {
			push("动作提交失败，请重试。", "CRITICAL");
		} finally {
			setBusy(false);
			inputRef.current?.focus();
		}
	}

	/** 行动面板入口：按钮 → 结构化动作（与斜杠命令同一 API/引擎）。 */
	function runAction(entry: ActionEntry) {
		const id = entry.id;
		if (id === "monitor") void runParsed({ type: "MONITOR", target: "vitals" });
		else if (id === "consult") void runParsed({ type: "CONSULT" });
		else if (id === "diag") {
			setDiagOpen(true);
			inputRef.current?.focus();
		} else if (id === "report") void runParsed({ type: "REPORT", target: "doctor" });
		else if (id === "wait") void runParsed({ type: "WAIT" });
		else if (id === "hint") void runParsed({ type: "HINT" });
	}

	/** 评估/检查/治疗 分组按钮的通用执行。 */
	function runCatalogAction(entry: ActionEntry, group: keyof ActionCatalog) {
		if (group === "assess") void runParsed({ type: "ASSESS", target: entry.id });
		else if (group === "order") void runParsed({ type: "ORDER", target: entry.id });
		else if (group === "give") void runParsed({ type: "GIVE", target: entry.id, text: String(doseValue[entry.id] ?? entry.default_dose ?? 1) });
	}

	function confirmDose(entry: ActionEntry) {
		void runParsed({ type: "GIVE", target: entry.id, text: String(doseValue[entry.id] ?? entry.default_dose ?? 1) });
		setDoseOpen(null);
	}

	function toggleDose(id: string) {
		setDoseOpen((cur) => (cur === id ? null : id));
		setDoseValue((v) => {
			const entry = catalog.give.find((a) => a.id === id);
			if (v[id] == null && entry?.default_dose != null) return { ...v, [id]: entry.default_dose };
			return v;
		});
	}

	function changeDose(id: string, next: number) {
		const entry = catalog.give.find((a) => a.id === id);
		const max = entry?.max_dose ?? Infinity;
		const min = 1;
		setDoseValue((v) => ({ ...v, [id]: Math.max(min, Math.min(max, next)) }));
	}

	function talkRole(role: string) {
		setInput(`/talk ${role} `);
		setPanelDismissed(false);
		inputRef.current?.focus();
	}

	async function submitDiagnosis() {
		if (!snapshot || busy || !diagDraft.trim()) return;
		setBusy(true);
		try {
			const r = await postSimulationAction(snapshot.session_id, {
				type: "DIAG",
				target: diagDraft.trim(),
			});
			setSnapshot(r.snapshot);
			setTranscript((t) => [
				...t,
				...r.messages.map(
					(m): TranscriptItem => ({
						key: `m${++seqRef.current}`,
						kind: "msg",
						text: m.text,
						msgKind: m.kind,
						atMinute: m.at_minute,
					}),
				),
			]);
		} catch {
			push("诊断保存失败，请重试。", "CRITICAL");
		} finally {
			setBusy(false);
		}
	}
	async function newSession(caseId?: string) {
		setBusy(true);
		try {
			const r = await createSimulationSession(caseId);
			localStorage.setItem(SESSION_KEY, String(r.session_id));
			setSnapshot(r.snapshot);
			setTranscript(
				r.snapshot.messages.map(
					(m): TranscriptItem => ({
						key: `m${++seqRef.current}`,
						kind: "msg",
						text: m.text,
						msgKind: m.kind,
						atMinute: m.at_minute,
					}),
				),
			);
			setHistory([]);
			setDiagDraft("");
			diagSyncedRef.current = false;
			setBriefOpen(true);
			setHintDismissed("");
			setDoseOpen(null);
		} catch {
			push("无法创建新会话。", "CRITICAL");
		} finally {
			setBusy(false);
			inputRef.current?.focus();
		}
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (panelVisible && visibleItems.length > 0) {
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelIndex((i) => (i < 0 ? visibleItems.length - 1 : Math.max(0, i - 1)));
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelIndex((i) => (i + 1) % visibleItems.length);
				return;
			}
			if (e.key === "Tab") {
				e.preventDefault();
				applyCompletion(visibleItems[selIndex >= 0 ? selIndex : 0]);
				return;
			}
			if (e.key === "Enter" && selIndex >= 0) {
				e.preventDefault();
				applyCompletion(visibleItems[selIndex]);
				return;
			}
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			if (!history.length) return;
			const idx =
				historyIdxRef.current == null
					? history.length - 1
					: Math.max(0, historyIdxRef.current - 1);
			historyIdxRef.current = idx;
			setInput(history[idx]);
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			if (historyIdxRef.current == null) return;
			const idx = historyIdxRef.current + 1;
			if (idx >= history.length) {
				historyIdxRef.current = null;
				setInput("");
			} else {
				historyIdxRef.current = idx;
				setInput(history[idx]);
			}
		}
	}

	const placeholder = busy
		? "处理中…"
		: caseEnded
			? "病例已结束。输入 /status 查看结果，或点「重新开始」"
			: "输入命令（如 /assess vitals），或点击右侧行动面板";

	const startClock = snapshot?.case_meta?.start_clock ?? "08:30";
	const tlModel = snapshot
		? buildTimelineModel(transcript, snapshot.pending ?? [], snapshot.current_time, startClock)
		: null;

	const catalog: ActionCatalog = snapshot?.actions ?? EMPTY_CATALOG;
	const brief = snapshot?.brief;
	const objectives = snapshot?.objectives;
	const hint = snapshot?.hint;
	const patient = snapshot?.patient;
	const latestVitals = (patient?.latest_vitals ?? null) as LatestVitals | null;
	const hintVisible = hint != null && hint.text !== hintDismissed && hint.text !== "";

	return (
		<div className="sim-root">
			<header className="sim-header">
				<div className="sim-titlerow">
					<div className="sim-title">{snapshot?.case_meta?.name ?? "腹部术后隐匿性出血"}</div>
					<div className="sim-actions">
						<button
							type="button"
							className="sim-btn"
							onClick={() => setBriefOpen((o) => !o)}
						>
							简报
						</button>
						<div className="sim-casemenu">
							<button
								type="button"
								disabled={busy}
								onClick={() => setCaseMenuOpen((o) => !o)}
								className="sim-btn"
							>
								切换病例
							</button>
							{caseMenuOpen ? (
								<div className="sim-casemenu-pop">
									{snapshot?.cases?.map((c) => (
										<button
											key={c.id}
											type="button"
											disabled={busy}
											className={
												c.id === snapshot.case_meta?.id ? "sim-casemenu-item sim-active" : "sim-casemenu-item"
											}
											onClick={() => {
												setCaseMenuOpen(false);
												if (c.id !== snapshot.case_meta?.id) void newSession(c.id);
											}}
										>
											{c.name}
											{c.id === snapshot.case_meta?.id ? "（当前）" : ""}
										</button>
									))}
								</div>
							) : null}
						</div>
						<button
							type="button"
							disabled={busy}
							onClick={() => void newSession()}
							className="sim-btn"
						>
							重新开始
						</button>
						<Link to="/training" className="sim-btn sim-btn-link">
							返回
						</Link>
					</div>
				</div>
				<div className="sim-meta">
					<span>{snapshot ? snapshot.clock : "--:--"}</span>
					<span className={snapshot?.case_status === "SUCCESS" ? "sim-ok" : snapshot?.case_status === "FAILURE" ? "sim-bad" : undefined}>
						{snapshot?.case_status ?? "…"}
					</span>
					<span>监护{snapshot?.monitoring ? "开" : "关"}</span>
					<span>检查点{snapshot?.diag_budget ?? 0}</span>
					<span>治疗点{snapshot?.treat_budget ?? 0}</span>
					{pendingCount > 0 ? (
						<span className="sim-pending">检查×{pendingCount}</span>
					) : null}
					{snapshot && snapshot.unrevealed_lab_count > 0 ? (
						<span className="sim-pending">待查看</span>
					) : null}
				</div>
				{objectives ? (
					<div className="sim-objrow">
						{(Object.keys(OBJECTIVE_LABEL) as ObjectiveKey[]).map((key) => {
							const done = objectives[key] === true;
							return (
								<span
									key={key}
									className={`sim-obj${done ? " sim-obj-done" : ""}`}
									title={`${OBJECTIVE_LABEL[key]}：${done ? "已完成" : "未完成"}`}
								>
									{done ? "✓" : "○"} {OBJECTIVE_LABEL[key]}
								</span>
							);
						})}
					</div>
				) : null}
			</header>

			{snapshot && tlModel ? (
				<SimTimeline
					model={tlModel}
					busy={busy}
					onWaitLab={(kind) => void runParsed({ type: "WAIT", target: kind.toUpperCase() })}
				/>
			) : null}

			<div className="sim-workbench">
				<div className="sim-main">
					<div ref={listRef} className="sim-log">
						{transcript.length === 0 ? (
							<div className="msg msg-system">
								<span className="msg-kind">[SYSTEM]</span>
								<span className="msg-text">
									病例已开始：腹部术后第 1 日患者，需关注隐匿性出血。输入 /help 查看可用命令与预算。
								</span>
							</div>
						) : (
							transcript.map((item) =>
								item.kind === "echo" ? (
									<div key={item.key} className="msg msg-echo">
										<span className="msg-kind">[INPUT]</span>
										<span className="msg-text">{item.text}</span>
									</div>
								) : (
									<div
										key={item.key}
										className={`msg msg-${(item.msgKind ?? "SYSTEM").toLowerCase()}`}
									>
										<span className="msg-kind">[{KIND_LABEL[item.msgKind ?? "SYSTEM"]}]</span>
										{item.atMinute != null ? (
											<span className="msg-time">
												{clockText(item.atMinute, snapshot?.case_meta?.start_clock)}
											</span>
										) : null}
										<span className="msg-text">{item.text}</span>
									</div>
								),
							)
						)}
					</div>

					{caseEnded ? (
						<div className={`sim-endbanner ${snapshot.case_status === "SUCCESS" ? "sim-endbanner-good" : "sim-endbanner-bad"}`}>
							<div className="sim-end-title">
								{snapshot.case_status === "SUCCESS"
									? "✓ 患者病情稳定，予以出院（较好结局）"
									: "✗ 患者病情恶化，病例失败"}
							</div>
							{objectives ? (
								<div className="sim-end-obj">
									{(Object.keys(OBJECTIVE_LABEL) as ObjectiveKey[]).map((key) => {
										const done = objectives[key] === true;
										return (
											<span key={key} className={`sim-obj${done ? " sim-obj-done" : ""}`}>
												{done ? "✓" : "○"} {OBJECTIVE_LABEL[key]}
											</span>
										);
									})}
									{objectives.timely ? (
										<span className="sim-obj sim-obj-done">
											{objectives.timely === "delayed" ? "⚠ 迟报" : "✓ 及时"}
										</span>
									) : null}
								</div>
							) : null}
							{snapshot?.teaching_points ? (
								<div className="sim-end-teach">📖 教学要点：{snapshot.teaching_points}</div>
							) : null}
							<div className="sim-end-sub">输入 /status 查看结算，或点「重新开始」再试一局。</div>
						</div>
					) : null}

					{!caseEnded ? (
						<div className="sim-diag">
							<button
								type="button"
								className="sim-diag-toggle"
								onClick={() => setDiagOpen((o) => !o)}
							>
								{diagOpen ? "▾" : "▸"} 诊断记录
								{snapshot?.diagnosis
									? "（已记录，报告时一并提交评分）"
									: "（可选：写下判断，便于报告时评分）"}
							</button>
							{diagOpen ? (
								<div className="sim-diag-body">
									<textarea
										value={diagDraft}
										onChange={(e) => setDiagDraft(e.target.value)}
										placeholder="写下你的诊断判断，可反复修改。例：疑诊糖尿病酮症酸中毒（高血糖 + 脱水 + 酸中毒）"
										spellCheck={false}
									/>
									<button
										type="button"
										className="sim-btn"
										disabled={busy || !diagDraft.trim()}
										onClick={() => void submitDiagnosis()}
									>
										保存诊断
									</button>
								</div>
							) : null}
						</div>
					) : null}

					{hintVisible ? (
						<div className="sim-hintbar">
							<span className="sim-hint-tag">教练 L{hint.level}</span>
							<span className="sim-hint-text">{hint.text}</span>
							<button
								type="button"
								className="sim-hint-close"
								aria-label="知道了"
								onClick={() => setHintDismissed(hint.text)}
								title="知道了"
							>
								✕
							</button>
						</div>
					) : null}

					{panelVisible ? (
						<div className="sim-completions">
							{groups.map((g) => {
								const open = isOpen(g.name);
								const start = visibleItems.indexOf(g.items[0]);
								return (
									<div key={g.name}>
										<button
											type="button"
											className={`sim-comp-group ${open ? "sim-comp-group-open" : ""}`}
											onClick={() => toggleGroup(g.name)}
										>
											<span className="sim-comp-group-name">{open ? "▾" : "▸"} {g.name}</span>
											<span className="sim-comp-group-desc">{g.desc}</span>
										</button>
										{open
											? g.items.map((c, i) => {
													const flat = start + i;
													return (
														<button
															key={c.text}
															type="button"
															className={`sim-comp ${flat === selIndex ? "sim-comp-sel" : ""}`}
															onMouseEnter={() => setSelIndex(flat)}
															onClick={() => applyCompletion(c)}
														>
															<span className="sim-comp-cmd">{c.label}</span>
															<span className="sim-comp-desc">{c.desc}</span>
														</button>
													);
												})
											: null}
									</div>
								);
							})}
						</div>
					) : null}

					<form
						className="sim-inputbar"
						onSubmit={(e) => {
							e.preventDefault();
							if (busy || !input.trim()) return;
							void run(input);
						}}
					>
						<span className="sim-prompt">&gt;</span>
						<input
							ref={inputRef}
							autoFocus
							value={input}
							placeholder={placeholder}
							onChange={(e) => {
								setInput(e.target.value);
								setPanelDismissed(false);
								setSelIndex(-1);
							}}
							onKeyDown={onKeyDown}
							spellCheck={false}
							autoComplete="off"
						/>
					</form>
				</div>

				<aside className="sim-sidebar">
					{brief ? (
						<section className="sim-panel sim-brief">
							<div className="sim-panel-head">
								<span>开局简报</span>
								<button type="button" className="sim-panel-fold" onClick={() => setBriefOpen((o) => !o)}>
									{briefOpen ? "▾" : "▸"}
								</button>
							</div>
							{briefOpen ? (
								<div className="sim-brief-body">
									<div className="sim-brief-patient">{brief.patient}</div>
									<div className="sim-brief-row">
										<span className="sim-brief-k">任务</span>
										<span>{brief.task}</span>
									</div>
									<div className="sim-brief-row">
										<span className="sim-brief-k">目标</span>
										<span>{brief.goal}</span>
									</div>
									<div className="sim-brief-row">
										<span className="sim-brief-k">资源</span>
										<span>检查点 {brief.resources?.diag ?? 0} · 治疗点 {brief.resources?.treat ?? 0} · 会诊 {brief.resources?.consult ?? 0}</span>
									</div>
									<div className="sim-brief-hint">💡 {brief.opening_hint}</div>
								</div>
							) : null}
						</section>
					) : null}

					{patient ? (
						<section className="sim-panel sim-patient">
							<div className="sim-panel-head">
								<span>床旁状态</span>
								<span className={`sim-conscious sim-conscious-${patient.consciousness}`}>
									{patient.consciousness_label}
								</span>
							</div>
							{latestVitals ? (
								<div className="sim-vitals">
									<div className={`sim-vital${latestVitals.hr >= 95 || latestVitals.hr <= 50 ? " sim-vital-bad" : ""}`}>
										<span className="sim-vital-v">{latestVitals.hr}</span>
										<span className="sim-vital-u">HR 次/分</span>
									</div>
									<div className={`sim-vital${latestVitals.sbp <= 108 || latestVitals.sbp >= 160 ? " sim-vital-bad" : ""}`}>
										<span className="sim-vital-v">{latestVitals.sbp}/{latestVitals.dbp}</span>
										<span className="sim-vital-u">BP mmHg</span>
									</div>
									<div className={`sim-vital${latestVitals.rr <= 10 || latestVitals.rr >= 28 ? " sim-vital-bad" : ""}`}>
										<span className="sim-vital-v">{latestVitals.rr}</span>
										<span className="sim-vital-u">RR 次/分</span>
									</div>
									<div className={`sim-vital${latestVitals.spo2 <= 92 ? " sim-vital-bad" : ""}`}>
										<span className="sim-vital-v">{latestVitals.spo2}%</span>
										<span className="sim-vital-u">SpO₂</span>
									</div>
									<div className={`sim-vital${latestVitals.temp >= 38 ? " sim-vital-bad" : ""}`}>
										<span className="sim-vital-v">{latestVitals.temp}℃</span>
										<span className="sim-vital-u">体温</span>
									</div>
								</div>
							) : (
								<div className="sim-patient-none">尚未评估生命体征</div>
							)}
						</section>
					) : null}

					<section className="sim-panel sim-actions">
						<div className="sim-panel-head">
							<span>行动面板</span>
							<span className="sim-panel-note">点击执行，代价透明</span>
						</div>

						{catalog.assess.length > 0 ? (
							<div className="sim-action-group">
								<div className="sim-action-group-title">评估</div>
								{catalog.assess.map((a) => (
									<ActionButton key={`assess-${a.id}`} entry={a} onRun={() => runCatalogAction(a, "assess")}
										doseOpen={false} onToggleDose={() => {}} doseValue={0} onDoseChange={() => {}} onConfirmDose={() => {}} disabled={busy} />
								))}
							</div>
						) : null}

						{catalog.order.length > 0 ? (
							<div className="sim-action-group">
								<div className="sim-action-group-title">检查</div>
								{catalog.order.map((a) => (
									<ActionButton key={`order-${a.id}`} entry={a} onRun={() => runCatalogAction(a, "order")}
										doseOpen={false} onToggleDose={() => {}} doseValue={0} onDoseChange={() => {}} onConfirmDose={() => {}} disabled={busy} />
								))}
							</div>
						) : null}

						{catalog.give.length > 0 ? (
							<div className="sim-action-group">
								<div className="sim-action-group-title">治疗</div>
								{catalog.give.map((a) => (
									<ActionButton key={`give-${a.id}`} entry={a} onRun={() => runCatalogAction(a, "give")}
										doseOpen={doseOpen === a.id}
										onToggleDose={toggleDose}
										doseValue={doseValue[a.id] ?? a.default_dose ?? 1}
										onDoseChange={changeDose}
										onConfirmDose={confirmDose}
										disabled={busy} />
								))}
							</div>
						) : null}

						{catalog.talk.length > 0 ? (
							<div className="sim-action-group">
								<div className="sim-action-group-title">沟通</div>
								{catalog.talk.map((a) => (
									<button
										key={`talk-${a.id}`}
										type="button"
										className={`sim-action-btn${a.enabled && !busy ? "" : " sim-action-disabled"}`}
										disabled={!a.enabled || busy}
										title={a.disabled_reason ?? "点击后在输入框输入你的话"}
										onClick={() => talkRole(a.id)}
									>
										<span className="sim-action-label">对{a.label}说话</span>
										<span className="sim-action-badge">2min</span>
									</button>
								))}
							</div>
						) : null}

						{catalog.manage.length > 0 ? (
							<div className="sim-action-group">
								<div className="sim-action-group-title">处理</div>
								{catalog.manage.map((a) => (
									<ActionButton key={`manage-${a.id}`} entry={a} onRun={() => runAction(a)}
										doseOpen={false} onToggleDose={() => {}} doseValue={0} onDoseChange={() => {}} onConfirmDose={() => {}} disabled={busy} />
								))}
							</div>
						) : null}
					</section>
				</aside>
			</div>
		</div>
	);
}
