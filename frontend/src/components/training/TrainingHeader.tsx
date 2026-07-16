import { ArrowLeft, Clock, EarOff, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePortrait, useTrainingContext } from "@/engine";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { getPatientAvatar } from "@/utils/avatar";
import { cn } from "@/utils/cn";

/**
 * Zero props — TrainingHeader reads all state from TrainingContext.
 * This avoids the prop-explosion problem that accumulated 13+ props.
 */
export function TrainingHeader() {
	const {
		patient,
		messages,
		ttsAutoPlay,
		toggleTts: onTtsToggle,
		endTraining: onEnd,
		timeLimitMinutes,
		remainingSeconds,
		voiceStatus,
	} = useTrainingContext();
	const navigate = useNavigate();
	const { portraitUrl } = usePortrait();
	const [ttsOpen, setTtsOpen] = useState(false);
	const [endConfirmOpen, setEndConfirmOpen] = useState(false);
	const [autoEndOpen, setAutoEndOpen] = useState(false);
	const [autoEndCountdown, setAutoEndCountdown] = useState(10);
	const endingRef = useRef(false);
	const autoEndTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const studentMsgs = messages.filter(m => m.role === "student");
	const studentCharCount = studentMsgs.reduce((sum, m) => sum + m.content.length, 0);
	const belowThreshold = studentMsgs.length < 3 || studentCharCount < 200;

	const initialRemaining =
		remainingSeconds ?? (timeLimitMinutes ? timeLimitMinutes * 60 : null);

	const {
		remaining,
		timerActive,
		stopTimer,
		formatTime,
	} = useTrainingTimer({
		initialRemaining,
		onAutoEnd: () => {
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

	const layout = useLayoutMode();
	const isCompact = layout === "phone";

	const avatarSrc =
		portraitUrl ||
		getPatientAvatar({ name: patient.name, gender: patient.gender });

	return (
		<>
			<header
				className="shrink-0 border-b border-border bg-card/95 backdrop-blur-sm px-2 sm:px-4 h-12 sm:h-14"
				style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
			>
				<div className="flex items-center gap-2 h-full">
					<button
						onClick={() => navigate("/training")}
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
						<span className="text-xs text-muted-foreground shrink-0 hidden sm:inline tabular-nums">
							{patient.gender === "male" ? "男" : "女"} · {patient.age}岁
						</span>
					)}

					<div
						className={cn(
							"flex items-center gap-1 px-2 py-1 rounded-md text-xs sm:text-sm font-bold tabular-nums border shrink-0 transition-colors",
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
						<Clock size={12} className="sm:size-[14px] shrink-0" />
						<span>{formatTime(remaining)}</span>
					</div>

					{!isCompact && (
					<button
						onClick={() => setTtsOpen(true)}
						className={cn(
							"w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 transition-colors hover:bg-muted",
							ttsAutoPlay &&
								"border-primary bg-primary/10 text-primary hover:bg-primary/20",
						)}
						title="语音设置"
					>
						{ttsAutoPlay ? (
							<Volume2 size={14} className="sm:size-[16px]" />
						) : (
							<EarOff size={14} className="sm:size-[16px]" />
						)}
					</button>
					)}

					

					<button
						data-end-training
						onClick={handleEndClick}
						className="flex items-center gap-1 px-2.5 h-9 rounded-md bg-destructive text-destructive-foreground text-xs sm:text-sm font-medium shrink-0 hover:bg-destructive/90 transition-colors active:scale-95 shadow-sm"
						title="结束训练并生成评分"
					>
						<X size={14} className="sm:size-[15px]" />
						<span className="hidden sm:inline">结束训练</span>
						<span className="sm:hidden">结束训练</span>
					</button>
				</div>
			</header>

			<Dialog
				open={endConfirmOpen}
				onOpenChange={(o) => !o && setEndConfirmOpen(false)}
			>
				<DialogContent title="结束训练" maxWidth={360}>
				<p className="text-sm text-muted-foreground mb-5">
					{belowThreshold
						? `当前对话内容较少（已发送 ${studentMsgs.length} 条），结束后将不会生成评分，确定结束？`
						: "确定要结束本次训练吗？结束后系统将自动生成评分。"}
				</p>
				<div className="flex justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setEndConfirmOpen(false)}
					>
						取消
					</Button>
					<Button variant="destructive" size="sm" onClick={executeEnd}>
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
				<p className="text-2xl font-bold text-center tabular-nums mb-5 text-destructive">
					{autoEndCountdown} 秒
				</p>
				<div className="flex justify-center">
					<Button variant="destructive" size="sm" onClick={executeEnd}>
						立即结束
					</Button>
				</div>
				</DialogContent>
			</Dialog>

			<Dialog
				open={ttsOpen}
				onOpenChange={(o) => !o && setTtsOpen(false)}
			>
				<DialogContent title="语音设置" maxWidth={360}>
				<div className="space-y-4">
					<p className="text-sm text-muted-foreground">
						配置训练中的语音朗读（TTS）选项
					</p>

					{/* Auto-play toggle */}
					<label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-primary/5">
						<div>
							<div className="text-sm font-medium">自动朗读</div>
							<div className="text-xs text-muted-foreground">
								患者回复后自动朗读
							</div>
						</div>
						<button
							type="button"
							onClick={onTtsToggle}
							className={cn(
								"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
								ttsAutoPlay ? "bg-primary" : "bg-muted-foreground/25",
							)}
						>
							<span
								className={cn(
									"inline-block size-4 transform rounded-full bg-white transition-transform shadow-sm",
									ttsAutoPlay ? "translate-x-[18px]" : "translate-x-0.5",
								)}
							/>
						</button>
					</label>

					{/* Provider status */}
					<div className="px-3 py-2.5 rounded-lg bg-muted/30">
						<div className="text-xs font-medium text-muted-foreground mb-1">语音引擎</div>
						<div className="flex items-center gap-2">
							<span className={cn(
								"size-2 rounded-full",
								!voiceStatus || voiceStatus.provider === "unavailable"
									? "bg-danger"
									: voiceStatus.provider.includes("browser")
										? "bg-warning"
										: "bg-success",
							)} />
							<span className="text-sm">
								{voiceStatus
									? `${voiceStatus.provider} (${voiceStatus.latencyMs}ms)`
									: "不可用"}
							</span>
						</div>
					</div>
				</div>
				<div className="flex justify-end mt-5">
					<Button variant="outline" size="sm" onClick={() => setTtsOpen(false)}>
						关闭
					</Button>
				</div>
				</DialogContent>
			</Dialog>

			
		</>
	);
}
