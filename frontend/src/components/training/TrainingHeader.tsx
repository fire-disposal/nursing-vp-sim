import { ArrowLeft, ClipboardCheck, Clock, EarOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { useTrainingStore } from "@/stores/trainingStore";
import PatientHeaderFace from "./face/PatientHeaderFace";

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
 * Zero props — TrainingHeader reads precisely selected fields from trainingStore.
 * This avoids the prop-explosion problem that accumulated 13+ props.
 */
interface TrainingHeaderProps {
	toggleTts: () => void;
	endTraining: () => Promise<void>;
}

export function TrainingHeader({ toggleTts: onTtsToggle, endTraining: onEnd }: TrainingHeaderProps) {
	const patient = useTrainingStore(s => s.patient);
	const mode = useTrainingStore(s => s.recordDetail?.mode);
	const hideCaseInfo = useTrainingStore(s => s.recordDetail?.hide_case_info === true);
	const isHiddenCase = mode === "blind_box" || hideCaseInfo;
	const trainingEnded = useTrainingStore(s => s.trainingEnded);
	const studentMsgCount = useTrainingStore(s => s.messages.filter(m => m.role === "student").length);
	const ttsAutoPlay = useTrainingStore(s => s.ttsAutoPlay);
	const isShort = useShortViewport();
	const navigate = useNavigate();
	const [endConfirmOpen, setEndConfirmOpen] = useState(false);
	const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
	const endingRef = useRef(false);
	const toast = useToast();
	// 自定义 detail 类型带索引签名，remaining_seconds 需显式窄化
	const initialRemaining = useTrainingStore((s) => s.recordDetail?.remaining_seconds) as number | null | undefined;

	const {
		remaining,
		formatTime,
	} = useTrainingTimer({
		initialRemainingSeconds: initialRemaining ?? null,
		enabled: !trainingEnded,
		onTimeUp: () => {
			// 温和提示：时间到不强制交卷，训练结束由用户主动触发
			toast.info("训练时间已到，你可以继续对话或随时结束训练");
		},
	});

	const executeEnd = useCallback(async () => {
		if (endingRef.current) return;
		endingRef.current = true;
		setEndConfirmOpen(false);
		try {
			await onEnd();
		} catch {
			toast.apiError(null, "结束训练失败，请重试");
		} finally {
			endingRef.current = false;
		}
	}, [onEnd, toast]);

	const handleEndClick = useCallback(() => {
		setEndConfirmOpen(true);
	}, []);

	if (!patient) {
		return (
			<header
				className={cn("absolute top-0 left-0 right-0 z-10 bg-card px-2 sm:px-4 shadow-e1", isShort ? "h-9" : "h-11 sm:h-12")}
				style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
			>
				<div className="flex h-full items-center text-xs text-muted-foreground">
					正在准备患者信息…
				</div>
			</header>
		);
	}

	return (
		<>
			<header
				className={cn("absolute top-0 left-0 right-0 z-10 bg-card px-2 sm:px-4 shadow-e1", isShort ? "h-9" : "h-11 sm:h-12")}
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

					{isHiddenCase ? (
						<div className="flex items-center gap-2 flex-1 min-w-0">
							<div className="text-xs sm:text-sm font-semibold text-foreground truncate leading-tight">
								{mode === "blind_box" ? "盲盒训练" : "隐藏病例练习"}
							</div>
							<div className="text-[10px] sm:text-xs text-muted-foreground truncate leading-tight">
								{mode === "blind_box" ? "随机病例 · 自主练习" : "病例固定 · 结束后揭示"}
							</div>
						</div>
					) : (
						<div className="flex items-center gap-2 flex-1 min-w-0">
							<PatientHeaderFace name={patient.name} />
							<div className="min-w-0">
								<div className="text-xs sm:text-sm font-semibold text-foreground truncate leading-tight">
									{patient.name}
								</div>
								<div className="text-[10px] sm:text-xs text-muted-foreground truncate leading-tight">
									{patient.caseTitle || patient.chiefComplaint}
								</div>
							</div>
						</div>
					)}

					{!isHiddenCase && patient.age != null && (
						<span className="text-xs text-muted-foreground shrink-0 tabular-nums">
							{patient.gender === "male" ? "男" : "女"} · {patient.age}岁
						</span>
					)}

					<div
						className={cn(
							"flex items-center gap-1.5 px-2 py-1 rounded-md text-xs sm:text-sm font-bold tabular-nums border shrink-0 transition-colors",
							remaining == null && "bg-muted/30 text-muted-foreground border-muted",
							remaining != null &&
								remaining <= 120 &&
								"border-transparent bg-danger text-danger-foreground",
							remaining != null &&
								remaining > 120 &&
								remaining <= 300 &&
								"border-transparent bg-warning text-warning-foreground",
							remaining != null &&
								remaining > 300 &&
								"border-border text-muted-foreground bg-card",
						)}
					>
						<WSStatusDot />
						<Clock size={12} className="sm:size-[14px] shrink-0" />
						<span>{formatTime(remaining)}</span>
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
					已发送 {studentMsgCount} 条消息，确定要结束本次训练吗？结束后系统将自动生成评分。
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

			<Dialog open={leaveDialogOpen} onOpenChange={(o) => !o && setLeaveDialogOpen(false)}>
				<DialogContent title="离开训练" maxWidth={300}>
					<p className="text-sm text-muted-foreground mb-5">训练仍在进行中，进度已自动保存</p>
					<div className="flex flex-col gap-2">
						<Button variant="default" onClick={() => { setLeaveDialogOpen(false); navigate(-1); }}>
							暂离，保留进度
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
