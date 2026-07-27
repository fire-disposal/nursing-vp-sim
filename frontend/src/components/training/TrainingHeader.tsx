import { ArrowLeft, ClipboardCheck, Clock, EarOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePortrait } from "@/engine";
import { useTrainingDynamic, useTrainingStatic, useTrainingUIState } from "@/engine/TrainingLayerContexts";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";
import { getPatientAvatar } from "@/utils/avatar";
import { cn } from "@/utils/cn";
import { useShortViewport } from "@/hooks/useShortViewport";

/** WS 实时连接状态点 — 绿=正常，黄（闪烁）=中断重连中。WS 承载查体/护理记录/评分推送。 */
function WSStatusDot() {
	const [connected, setConnected] = useState(false);
	useEffect(() => subscribeWSConnection(setConnected), []);
	const label = connected
		? "实时连接正常"
		: "实时连接中断，工具暂不可用，正在自动重连…";
	return (
		<span
			role="status"
			aria-label={label}
			title={label}
			className={cn(
				"size-2 shrink-0 rounded-full",
				connected ? "bg-success" : "bg-warning animate-pulse",
			)}
		/>
	);
}

/**
 * Zero props — TrainingHeader reads all state from TrainingContext.
 * This avoids the prop-explosion problem that accumulated 13+ props.
 */
export function TrainingHeader() {
	const staticCtx = useTrainingStatic();
	const dynamicCtx = useTrainingDynamic();
	const uiCtx = useTrainingUIState();
	const {
		patient,
		timeLimitMinutes,
	} = staticCtx;
	const { messages } = dynamicCtx;
	const {
		ttsAutoPlay,
		toggleTts: onTtsToggle,
		endTraining: onEnd,
		remainingSeconds,
	} = uiCtx;
	const isShort = useShortViewport();
	const navigate = useNavigate();
	const { portraitUrl } = usePortrait();
	const [endConfirmOpen, setEndConfirmOpen] = useState(false);
	const [autoEndOpen, setAutoEndOpen] = useState(false);
	const [autoEndCountdown, setAutoEndCountdown] = useState(10);
	const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const endingRef = useRef(false);
	const autoEndTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const autoEndFiredRef = useRef(false);


	const studentMsgs = messages.filter(m => m.role === "student");
	const hasStarted = studentMsgs.length > 0;
	const initialRemaining =
		!hasStarted ? null
		: autoEndFiredRef.current ? null
		: remainingSeconds ?? (timeLimitMinutes ? timeLimitMinutes * 60 : null);

	const {
		remaining,
		timerActive,
		stopTimer,
		formatTime,
	} = useTrainingTimer({
		initialRemaining,
		onAutoEnd: () => {
			autoEndFiredRef.current = true;
			setAutoEndOpen(true);
			setAutoEndCountdown(10);
			stopTimer();
		},
	});

	const executeEnd = useCallback(async () => {
		if (endingRef.current) return;
		endingRef.current = true;
		setEndConfirmOpen(false);
		setAutoEndOpen(false);
		try {
			await onEnd();
		} finally {
			endingRef.current = false;
		}
	}, [onEnd]);

	const handleEndClick = useCallback(() => {
		setEndConfirmOpen(true);
	}, []);

	useEffect(() => {
		if (!autoEndOpen) return;
		autoEndTimerRef.current = setInterval(() => {
			setAutoEndCountdown((c) => (c <= 1 ? 0 : c - 1));
		}, 1000);
		return () => {
			if (autoEndTimerRef.current) clearInterval(autoEndTimerRef.current);
		};
	}, [autoEndOpen]);

	useEffect(() => {
		if (autoEndOpen && autoEndCountdown === 0) {
			executeEnd();
		}
	}, [autoEndOpen, autoEndCountdown, executeEnd]);

	const avatarSrc =
		portraitUrl ||
		getPatientAvatar({ name: patient.name, gender: patient.gender });

	return (
		<>
			<header
				className={cn("absolute top-0 left-0 right-0 z-10 bg-card/80 backdrop-blur-sm px-2 sm:px-4 shadow-sm", isShort ? "h-9" : "h-11 sm:h-12")}
				style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
			>
				<div className="flex items-center gap-2 h-full">
					<button
						onClick={() => setLeaveDialogOpen(true)}
						className="size-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted hover:text-foreground transition-colors"
						title="返回训练选择"
						aria-label="返回训练选择"
					>
						<ArrowLeft size={16} className="sm:size-[18px]" />
					</button>

					<div className="flex items-center gap-2 flex-1 min-w-0">
						<img
							className="size-6 sm:w-9 sm:h-9 rounded-full object-cover shrink-0 bg-muted ring-2 ring-border"
							src={avatarSrc}
							alt={patient.name}
						/>
						<div className="min-w-0">
							<div className="text-xs sm:text-sm font-semibold text-foreground truncate leading-tight">
								{patient.name}
							</div>
							<div className="text-[10px] sm:text-xs text-muted-foreground truncate leading-tight">
								{patient.caseTitle || patient.chiefComplaint}
							</div>
						</div>
					</div>

					{patient.age != null && (
						<span className="text-xs text-muted-foreground shrink-0 tabular-nums">
							{patient.gender === "male" ? "男" : "女"} · {patient.age}岁
						</span>
					)}

					<div
						className={cn(
							"flex items-center gap-1.5 px-2 py-1 rounded-md text-xs sm:text-sm font-bold tabular-nums border shrink-0 transition-colors",
							!timerActive && "bg-muted/30 text-muted-foreground border-muted",
							timerActive &&
								remaining != null &&
							remaining <= 120 &&
							"border-transparent bg-danger text-danger-foreground",
							timerActive &&
								remaining != null &&
								remaining > 120 &&
								remaining <= 300 &&
								"border-transparent bg-warning text-warning-foreground",
							timerActive &&
								remaining != null &&
								remaining > 300 &&
								"border-border text-muted-foreground bg-card",
						)}
					>
						<WSStatusDot />
						<Clock size={12} className="sm:size-[14px] shrink-0" />
						<span>{formatTime(hasStarted && remaining != null ? remaining : timeLimitMinutes * 60)}</span>
					</div>

					<button
						type="button"
						onClick={onTtsToggle}
						className={cn(
							"size-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 transition-colors hover:bg-muted",
							ttsAutoPlay && "border-primary bg-primary/10 text-primary hover:bg-primary/20",
						)}
						title={ttsAutoPlay ? "关闭朗读" : "开启朗读"}
					>
						{ttsAutoPlay ? <Volume2 size={16} /> : <EarOff size={16} />}
					</button>
					<Button
						variant="destructive"
						size="sm"
						onClick={handleEndClick}
						title="完成训练并查看评分"
					>
						<ClipboardCheck size={14} className="sm:size-[15px]" />
						<span className="hidden sm:inline">完成训练</span>
						<span className="sm:hidden">完成</span>
					</Button>
				</div>
			</header>

			<Dialog
				open={endConfirmOpen}
				onOpenChange={(o) => !o && setEndConfirmOpen(false)}>
				<DialogContent title="结束训练" maxWidth={360}>
				<p className="text-sm text-muted-foreground mb-5">
					已发送 {studentMsgs.length} 条消息，确定要结束本次训练吗？结束后系统将自动生成评分。
				</p>
				<div className="flex justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setEndConfirmOpen(false)}
					>
						取消
					</Button>
					<Button variant="end" size="sm" onClick={executeEnd}>
						确认结束
					</Button>
				</div>
				</DialogContent>
			</Dialog>

			<Dialog
				open={autoEndOpen}
				onOpenChange={(o) => !o && setAutoEndOpen(false)}
			>
				<DialogContent title="训练时间到" maxWidth={360}>
				<p className="text-sm text-muted-foreground mb-2">
					本次训练时间已用尽，即将自动结束。
				</p>
				<p className="text-2xl font-bold text-center tabular-nums mb-5 text-end">
					{autoEndCountdown} 秒
				</p>
				<div className="flex justify-center">
					<Button variant="end" size="sm" onClick={executeEnd}>
						立即结束
					</Button>
				</div>
				</DialogContent>
			</Dialog>

			<Dialog open={leaveDialogOpen} onOpenChange={(o) => !o && setLeaveDialogOpen(false)}>
				<DialogContent title="离开训练" maxWidth={300}>
					<p className="text-sm text-muted-foreground mb-5">训练仍在进行中</p>
					<div className="flex flex-col gap-2">
						<Button variant="outline" onClick={() => { setLeaveDialogOpen(false); navigate("/training"); }}>
							暂离，保留进度
						</Button>
						<Button variant="destructive" onClick={async () => {
							setLeaving(true);
							try { await onEnd(); } catch { /* ignore */ }
							setLeaving(false);
							setLeaveDialogOpen(false);
							navigate("/training");
						}} disabled={leaving}>
							结束训练并评分
						</Button>
						<Button variant="outline" onClick={() => setLeaveDialogOpen(false)}>
							继续训练
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
