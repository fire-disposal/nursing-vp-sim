import { ClipboardList, Clock, MessageCircle, Minus, Plus, Smile, Star, Stethoscope, User } from "lucide-react";
import { useCallback, useState } from "react";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/utils/cn";

interface PatientInfo {
    name: string;
    difficulty: number;
    description?: string | null;
    patient_summary?: { gender?: string; age?: number; chief_complaint?: string } | null;
}

interface Props {
    open: boolean;
    caseInfo: PatientInfo;
    trainingType: string;
    onClose: () => void;
    onStart: (features: Record<string, boolean>, timeLimit: number) => void;
    loading?: boolean;
}

export default function TrainingConfigModal({ open, caseInfo, trainingType, onClose, onStart, loading }: Props) {
    const [exam, setExam] = useState(false);
    const [advanced, setAdvanced] = useState(false);
    const [questionnaire, setQuestionnaire] = useState(false);
    const [timeLimit, setTimeLimit] = useState(20);

    const isHistoryTaking = trainingType === "history_taking";

    const handleStart = useCallback(() => {
        const features: Record<string, boolean> = {};
        if (isHistoryTaking) {
            features.physical_exam = exam;
            if (advanced) {
                features.emotion = true;
                features.patient_initiative = true;
            }
        }
        if (questionnaire) features.questionnaire = true;
        onStart(features, timeLimit);
    }, [isHistoryTaking, exam, advanced, questionnaire, timeLimit, onStart]);

    const summary = caseInfo.patient_summary;
    const diffStars = Array.from({ length: 3 }, (_, i) => i < (caseInfo.difficulty || 1));

    const adjustTime = (delta: number) => setTimeLimit((t) => Math.min(60, Math.max(5, t + delta)));

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent title="训练配置" maxWidth={480}>
            <div className="flex flex-col gap-5 pb-1">
                {/* Case Preview */}
                <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-primary/[0.02] p-4">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <h3 className="font-semibold text-base">{caseInfo.name}</h3>
                            {caseInfo.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{caseInfo.description}</p>
                            )}
                        </div>
                        <div className="flex gap-0.5 shrink-0">
                            {diffStars.map((filled, i) => (
                                <Star key={i} size={14} fill={filled ? "#f59e0b" : "none"} color={filled ? "#f59e0b" : "#d1d5db"} />
                            ))}
                        </div>
                    </div>
                    {summary && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                            {summary.gender && (
                                <span className="inline-flex items-center gap-1"><User size={12} />{summary.gender === "男" ? "男性" : summary.gender === "女" ? "女性" : summary.gender}</span>
                            )}
                            {typeof summary.age === "number" && <span>{summary.age}岁</span>}
                            {summary.chief_complaint && <span className="truncate max-w-[200px]">主诉：{summary.chief_complaint}</span>}
                        </div>
                    )}
                </div>

                {isHistoryTaking && (
                    <>
                    {/* Section: 练什么 */}
                    <div>
                        <span className="text-sm font-medium mb-3 block">你要练什么？</span>
                        <button
                            type="button"
                            onClick={() => setExam((v) => !v)}
                            className={cn(
                                "flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-all",
                                exam ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/20 hover:bg-muted/50",
                            )}
                        >
                            <div className={cn("flex size-9 items-center justify-center rounded-lg shrink-0", exam ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                                <Stethoscope size={18} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium">护理查体</p>
                                <p className="text-[11px] text-muted-foreground">执行生命体征、体格检查等操作</p>
                            </div>
                            <div className={cn("h-5 w-9 rounded-full transition-colors shrink-0", exam ? "bg-primary" : "bg-muted-foreground/25")}>
                                <div className={cn("size-4 rounded-full bg-white shadow-sm transition-transform mt-0.5", exam ? "translate-x-[18px]" : "translate-x-[2px]")} />
                            </div>
                        </button>
                    </div>

                    {/* Section: 真实度 */}
                    <div>
                        <span className="text-sm font-medium mb-3 block">患者要有多真实？</span>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setAdvanced(false)}
                                className={cn("flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all", !advanced ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/20 hover:bg-muted/50")}
                            >
                                <Smile size={18} className={!advanced ? "text-primary" : "text-muted-foreground"} />
                                <div>
                                    <p className="text-sm font-medium">基础</p>
                                    <p className="text-[11px] text-muted-foreground">纯问诊，患者被动应答</p>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setAdvanced(true)}
                                className={cn("flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all", advanced ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/20 hover:bg-muted/50")}
                            >
                                <MessageCircle size={18} className={advanced ? "text-primary" : "text-muted-foreground"} />
                                <div>
                                    <p className="text-sm font-medium">进阶</p>
                                    <p className="text-[11px] text-muted-foreground">情绪变化 + 主动追问{exam ? " + 查体联动" : ""}</p>
                                </div>
                            </button>
                        </div>
                    </div>
                    </>
                )}

                {trainingType === "triage" && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">🚑</span>
                            <div>
                                <p className="font-medium text-orange-800">预检分诊训练</p>
                                <p className="text-sm text-orange-600">快速评估患者，完成分诊判定</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Section: 训练后 — only for history_taking */}
                {isHistoryTaking && (
                    <div>
                        <span className="text-sm font-medium mb-3 block">训练结束后</span>
                        <button
                            type="button"
                            onClick={() => setQuestionnaire((v) => !v)}
                            className={cn(
                                "flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-all",
                                questionnaire ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/20 hover:bg-muted/50",
                            )}
                        >
                            <div className={cn("flex size-9 items-center justify-center rounded-lg shrink-0", questionnaire ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                                <ClipboardList size={18} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium">填写评估问卷</p>
                                <p className="text-[11px] text-muted-foreground">训练结束后弹出评估问卷</p>
                            </div>
                            <div className={cn("h-5 w-9 rounded-full transition-colors shrink-0", questionnaire ? "bg-primary" : "bg-muted-foreground/25")}>
                                <div className={cn("size-4 rounded-full bg-white shadow-sm transition-transform mt-0.5", questionnaire ? "translate-x-[18px]" : "translate-x-[2px]")} />
                            </div>
                        </button>
                    </div>
                )}

                {/* Time */}
                <div>
                    <span className="text-sm font-medium mb-3 block">时长限制</span>
                    <div className="flex items-center gap-3 rounded-lg border p-3">
                        <Clock size={18} className="text-muted-foreground shrink-0" />
                        <div className="flex-1">
                            <input type="range" min={5} max={isHistoryTaking ? 60 : 30} step={5} value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))}
                                className="w-full h-2 rounded-full appearance-none bg-muted cursor-pointer accent-primary" />
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => adjustTime(-5)} className="size-7 flex items-center justify-center rounded-md hover:bg-muted"><Minus size={14} /></button>
                            <span className="w-10 text-center text-sm font-semibold tabular-nums">{timeLimit}</span>
                            <button type="button" onClick={() => adjustTime(5)} className="size-7 flex items-center justify-center rounded-md hover:bg-muted"><Plus size={14} /></button>
                            <span className="text-xs text-muted-foreground">分钟</span>
                        </div>
                    </div>
                </div>

                <Button onClick={handleStart} disabled={loading} className="w-full h-11 text-base font-semibold" size="lg">
                    {loading ? "启动中..." : "开始训练"}
                </Button>
            </div>
            </DialogContent>
        </Dialog>
    );
}
