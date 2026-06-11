import {
	ArrowLeft,
	Clock,
	Ear,
	EarOff,
	MonitorCog,
	Pause,
	Phone,
	Play,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { updateTrainingFeatures } from "@/api/training-state";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { usePortrait } from "@/engine/PluginContext";
import type { PatientData } from "@/engine/types";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { cn } from "@/lib/utils";
import { getPatientAvatar } from "@/utils/avatar";

const FEATURE_META: Record<string, { label: string; desc: string }> = {
	emotion: {
		label: "患者情绪状态机",
		desc: "2D 信赖-舒适模型，根据学生用语动态变化患者情绪反应",
	},
	physical_exam: {
		label: "护理查体",
		desc: "通过专属面板执行生命体征、循环氧合、体格检查等操作",
	},
	patient_initiative: {
		label: "患者主动追问",
		desc: "患者根据性格/情绪/等待时长主动发言（依赖情绪状态机）",
	},
	portrait: { label: "患者立绘", desc: "在训练界面显示患者人物立绘图片" },
	questionnaire: {
		label: "问卷评估",
		desc: "训练结束后弹出评估问卷供学生填写",
	},
	exam_emotion_bridge: {
		label: "查体-情绪联动",
		desc: "查体操作影响患者心态，缺乏解释或不相关检查会降低信任/舒适度",
	},
	allow_pause: {
		label: "允许暂停计时",
		desc: "允许学生在训练中暂停倒计时。后台结算以服务器时间为准",
	},
};

interface TrainingHeaderProps {
	recordId: string;
	patient: PatientData;
	features: Record<string, boolean>;
	onToggleFeature: (key: string, enabled: boolean) => void;
	ttsAutoPlay: boolean;
	onTtsToggle: () => void;
	onEnd: () => Promise<void>;
	sending: boolean;
	featuresLocked?: boolean;
	fromAssignment?: boolean;
	timeLimitMinutes?: number;
	remainingSeconds?: number | null;
}

export function TrainingHeader({
	recordId,
	patient,
	features,
	onToggleFeature,
	ttsAutoPlay,
	onTtsToggle,
	onEnd,
	sending: _sending,
	featuresLocked = false,
	fromAssignment = false,
	timeLimitMinutes,
	remainingSeconds,
}: TrainingHeaderProps) {
	const navigate = useNavigate();
	const { portraitUrl } = usePortrait();
	const [featuresOpen, setFeaturesOpen] = useState(false);
	const [endConfirmOpen, setEndConfirmOpen] = useState(false);
	const [autoEndOpen, setAutoEndOpen] = useState(false);
	const [autoEndCountdown, setAutoEndCountdown] = useState(10);
	const endingRef = useRef(false);
	const autoEndTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const initialRemaining =
		remainingSeconds ?? (timeLimitMinutes ? timeLimitMinutes * 60 : 30 * 60);

	const {
		remaining,
		timerActive,
		stopTimer,
		resetTimer,
		formatTime,
		setTimerActive,
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

	const handleToggleFeature = useCallback(
		async (key: string, enabled: boolean) => {
			onToggleFeature(key, enabled);
			try {
				await updateTrainingFeatures(Number(recordId), { [key]: enabled });
			} catch {
				/* silent */
			}
		},
		[onToggleFeature, recordId],
	);

	const handlePauseToggle = useCallback(() => {
		if (timerActive) {
			stopTimer();
		} else {
			setTimerActive(true);
		}
	}, [timerActive, stopTimer, setTimerActive]);

	const allowPause = features.allow_pause ?? false;

	const avatarSrc =
		portraitUrl ||
		getPatientAvatar({ name: patient.name, gender: patient.gender });

	return (
		<>
			<header
				className="shrink-0 border-b border-border bg-card px-2 py-1 sm:px-4 sm:py-0 sm:h-14"
				style={{ paddingTop: "max(env(safe-area-inset-top), 8px)" }}
			>
				<div className="flex items-center gap-2 h-full">
					<button
						onClick={() => navigate("/cases")}
						className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted hover:text-foreground transition-colors"
						title="返回病例选择"
						aria-label="返回病例选择"
					>
						<ArrowLeft size={16} className="sm:size-[18px]" />
					</button>

					<div className="flex items-center gap-2 flex-1 min-w-0">
						<img
							className="w-7 h-7 sm:w-9 sm:h-9 rounded-full object-cover shrink-0 bg-muted ring-2 ring-border"
							src={avatarSrc}
							alt={patient.name}
						/>
						<div className="min-w-0">
							<div className="text-xs sm:text-sm font-semibold text-foreground truncate">
								{patient.name}
							</div>
							<div className="text-[0.65rem] sm:text-xs text-muted-foreground truncate">
								{patient.caseTitle}
							</div>
						</div>
					</div>

					<div
						className={cn(
							"flex items-center gap-1 px-2 py-1 rounded-md text-xs sm:text-sm font-bold tabular-nums border shrink-0 transition-colors",
							!timerActive && "bg-muted/30 text-muted-foreground border-muted",
							timerActive &&
								remaining != null &&
								remaining <= 120 &&
								"border-red-200 bg-red-50 text-red-600",
							timerActive &&
								remaining != null &&
								remaining > 120 &&
								remaining <= 300 &&
								"border-amber-200 bg-amber-50 text-amber-600",
							timerActive &&
								remaining != null &&
								remaining > 300 &&
								"border-border text-muted-foreground bg-card",
						)}
					>
						<Clock size={12} className="sm:size-[14px] shrink-0" />
						<span>{formatTime(remaining)}</span>
						{allowPause && (
							<button
								onClick={handlePauseToggle}
								className="text-xs text-muted-foreground ml-0.5 hover:text-foreground"
								title={timerActive ? "暂停计时" : "恢复计时"}
							>
								{timerActive ? (
									<Pause size={12} className="sm:size-[14px]" />
								) : (
									<Play size={12} className="sm:size-[14px]" />
								)}
							</button>
						)}
					</div>

					<button
						onClick={onTtsToggle}
						className={cn(
							"w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 transition-colors hover:bg-muted",
							ttsAutoPlay &&
								"border-primary bg-primary/10 text-primary hover:bg-primary/20",
						)}
						title={ttsAutoPlay ? "关闭自动朗读" : "开启自动朗读"}
					>
						{ttsAutoPlay ? (
							<Ear size={14} className="sm:size-[16px]" />
						) : (
							<EarOff size={14} className="sm:size-[16px]" />
						)}
					</button>

					<button
						onClick={() => setFeaturesOpen(true)}
						className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted transition-colors"
						title="插件特性"
					>
						<MonitorCog size={14} className="sm:size-[16px]" />
					</button>

					<button
						onClick={handleEndClick}
						className="flex items-center gap-1 px-2.5 h-10 sm:h-9 rounded-md border border-destructive/30 bg-card text-destructive text-xs sm:text-sm font-medium shrink-0 hover:bg-destructive/10 transition-colors"
						title="结束训练并生成评分"
					>
						<Phone size={13} className="sm:size-[15px]" />
						<span className="hidden sm:block">结束训练</span>
						<span className="sm:hidden">结束</span>
					</button>
				</div>
			</header>

			<Modal
				open={endConfirmOpen}
				onClose={() => setEndConfirmOpen(false)}
				title="结束训练"
				maxWidth={360}
			>
				<p className="text-sm text-muted-foreground mb-5">
					确定要结束本次训练吗？结束后系统将自动生成评分。
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
			</Modal>

			<Modal
				open={autoEndOpen}
				onClose={() => setAutoEndOpen(false)}
				title="训练时间到"
				maxWidth={360}
			>
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
			</Modal>

			<Modal
				open={featuresOpen}
				onClose={() => setFeaturesOpen(false)}
				title="插件特性"
				maxWidth={420}
			>
				{featuresLocked ? (
					<p className="text-sm text-amber-600 bg-amber-50 rounded-md px-3 py-2 mb-3">
						此练习的插件配置由教师设定，不可更改
					</p>
				) : (
					<p className="text-sm text-muted-foreground mb-4">
						当前病例启用的训练特性，可在训练中随时开关以观察效果
					</p>
				)}
				<div className="flex flex-col gap-1">
					{Object.entries(FEATURE_META).map(([key, meta]) => {
						const enabled = features[key] ?? false;
						return (
							<label
								key={key}
								className={cn(
									"flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-colors",
									enabled ? "bg-primary/5" : "bg-muted/30",
								)}
							>
								<div className="min-w-0">
									<div className="text-sm font-medium">{meta.label}</div>
									<div className="text-xs text-muted-foreground">
										{meta.desc}
									</div>
								</div>
								<button
									type="button"
									disabled={featuresLocked}
									onClick={() => handleToggleFeature(key, !enabled)}
									className={cn(
										"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
										enabled ? "bg-primary" : "bg-gray-300",
										featuresLocked && "opacity-50 cursor-not-allowed",
									)}
								>
									<span
										className={cn(
											"inline-block size-4 transform rounded-full bg-white transition-transform shadow-sm",
											enabled ? "translate-x-[18px]" : "translate-x-0.5",
										)}
									/>
								</button>
							</label>
						);
					})}
				</div>
				<div className="flex justify-end mt-5">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setFeaturesOpen(false)}
					>
						关闭
					</Button>
				</div>
			</Modal>
		</>
	);
}
