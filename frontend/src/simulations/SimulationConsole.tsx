import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import {
	createSimulationSession,
	getSimulationSession,
	postSimulationAction,
} from "@/api/simulations";
import { parseCommand } from "./parser";
import { TIMELINE_LEGEND, buildTimeline } from "./timeline";
import "./console.css";

type SimulationSnapshot = components["schemas"]["SimulationSnapshot"];

const SESSION_KEY = "simulation.sessionId";

// Game minute 0 == 08:30 (must stay in sync with backend case.py).
function clockText(minute: number): string {
	const total = 8 * 60 + 30 + minute;
	const hh = Math.floor(total / 60) % 24;
	const mm = total % 60;
	return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const KIND_LABEL: Record<string, string> = {
	SYSTEM: "SYSTEM",
	ASSESSMENT: "ASSESSMENT",
	MONITOR: "MONITOR",
	LAB: "LAB",
	WARNING: "WARNING",
	CRITICAL: "CRITICAL",
	AUDIT: "AUDIT",
};

interface TranscriptItem {
	key: string;
	kind: "echo" | "msg";
	text: string;
	msgKind?: string;
	atMinute?: number;
}

export default function SimulationConsole() {
	const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
	const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [history, setHistory] = useState<string[]>([]);
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

	const pendingCount = snapshot?.pending.length ?? 0;
	const caseEnded = snapshot != null && snapshot.case_status !== "ACTIVE";

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

	async function newSession() {
		setBusy(true);
		try {
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
			setHistory([]);
		} catch {
			push("无法创建新会话。", "CRITICAL");
		} finally {
			setBusy(false);
			inputRef.current?.focus();
		}
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
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
			: "输入命令，如 /order cbc";

	const tl = snapshot ? buildTimeline(transcript, snapshot.current_time) : null;

	return (
		<div className="sim-root">
			<header className="sim-header">
				<div className="sim-title">腹部术后隐匿性出血（临床推理模拟）</div>
				<div className="sim-goal">
					目标：评估 → 检查 → 报告，尽早发现并报告隐匿性出血，患者顺利出院。
					用 /diag 写下你的诊断，/report doctor 提交。
				</div>
				<div className="sim-meta">
					<span>
						时间 <b>{snapshot ? snapshot.clock : "--:--"}</b>
					</span>
					<span>
						状态 <b>{snapshot?.case_status ?? "…"}</b>
					</span>
					<span>
						监护 <b>{snapshot?.monitoring ? "开启" : "关闭"}</b>
					</span>
					<span>
						预算 <b>¥{snapshot?.budget ?? 0}</b>
					</span>
					<span>
						已用 <b>¥{snapshot?.cost_total ?? 0}</b>
					</span>
					{pendingCount > 0 ? (
						<span className="sim-pending">检查进行中 ×{pendingCount}</span>
					) : null}
					{snapshot && snapshot.unrevealed_lab_count > 0 ? (
						<span className="sim-pending">有检查已返回未查看（/view）</span>
					) : null}
				</div>
				<div className="sim-actions">
					<button
						type="button"
						disabled={busy}
						onClick={newSession}
						className="sim-btn"
					>
						重新开始
					</button>
					<Link to="/training" className="sim-btn sim-btn-link">
						返回系统
					</Link>
				</div>
			</header>

			{snapshot && tl ? (
				<div className="sim-timeline">
					<div className="tl-rows">
						<div className="tl-bar">08:30 {tl.bar} 10:30</div>
						<div className="tl-cursor">{tl.cursor}</div>
						<div className="tl-legend">{TIMELINE_LEGEND}</div>
					</div>
				</div>
			) : null}

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
								<span className="msg-kind">
									[{KIND_LABEL[item.msgKind ?? "SYSTEM"]}]
								</span>
								{item.atMinute != null ? (
									<span className="msg-time">{clockText(item.atMinute)}</span>
								) : null}
								<span className="msg-text">{item.text}</span>
							</div>
						),
					)
				)}
			</div>

			{caseEnded ? (
				<div className={`sim-endbanner ${snapshot.case_status === "SUCCESS" ? "sim-endbanner-good" : "sim-endbanner-bad"}`}>
					{snapshot.case_status === "SUCCESS"
						? "患者病情稳定，予以出院（较好结局）。输入 /status 查看结算，或点「重新开始」。"
						: "患者病情恶化，病例失败。输入 /status 查看结算，或点「重新开始」。"
					}
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
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={onKeyDown}
					spellCheck={false}
					autoComplete="off"
				/>
			</form>
		</div>
	);
}
