import { useEffect } from "react";
import type { EmotionState } from "@/engine/PluginContext";
import {
	EMOTION_LABELS,
	useEmotion,
	usePortrait,
} from "@/engine/PluginContext";
import type { PanelTabProps } from "@/engine/types";

const EMOTION_FILES: Record<EmotionState, string> = {
	withdrawn: "withdrawn.png",
	defensive: "defensive.png",
	neutral: "neutral.png",
	relaxed: "relaxed.png",
	open: "open.png",
};

function PatientAvatar({
	ctx,
	features,
}: {
	ctx: PanelTabProps["ctx"];
	features?: Record<string, boolean>;
}) {
	const portraitEnabled = features?.portrait;
	const { portraitUrl, setPortraitUrl } = usePortrait();
	const { emotion } = useEmotion();

	useEffect(() => {
		if (!portraitEnabled) return;
		const unsub = ctx.bus.on(
			"emotion:changed",
			(data: { emotion: EmotionState }) => {
				const url = `/portraits/${ctx.patient.caseTitle || "default"}/${EMOTION_FILES[data.emotion] || "neutral.png"}`;
				setPortraitUrl(url);
			},
		);
		return unsub;
	}, [ctx.bus, ctx.patient.caseTitle, setPortraitUrl, portraitEnabled]);

	if (portraitEnabled && portraitUrl) {
		return (
			<div className="text-center">
				<img
					src={portraitUrl}
					alt="患者立绘"
					loading="lazy"
					className="w-24 h-24 mx-auto rounded-full border-2 border-border bg-muted object-cover"
					onError={(e) => {
						(e.target as HTMLImageElement).style.display = "none";
					}}
				/>
				<p className="text-[0.6rem] text-muted-foreground mt-1">
					{EMOTION_LABELS[emotion]}
				</p>
			</div>
		);
	}

	return (
		<div className="text-center">
			<div className="w-24 h-24 mx-auto rounded-full border-2 border-border bg-muted flex items-center justify-center">
				<span className="text-3xl">
					{ctx.patient.gender === "male" ? "👨" : "👩"}
				</span>
			</div>
		</div>
	);
}

export function PatientInfoTab({ ctx, features }: PanelTabProps) {
	const p = ctx.patient;
	if (!p) return null;

	return (
		<div className="space-y-4">
			<PatientAvatar ctx={ctx} features={features} />
			<div className="text-center">
				<div className="text-sm font-semibold">{p.name}</div>
				<div className="text-xs text-muted-foreground">
					{[p.gender === "male" ? "男" : "女", p.age ? `${p.age}岁` : ""]
						.filter(Boolean)
						.join(" · ")}
				</div>
			</div>
			<div className="space-y-3">
				{p.chiefComplaint && (
					<div className="rounded-lg border bg-muted/30 p-3">
						<div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
							主诉
						</div>
						<p className="text-xs leading-relaxed">{p.chiefComplaint}</p>
					</div>
				)}
				{p.personality && (
					<div className="rounded-lg border bg-muted/30 p-3">
						<div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
							性格特征
						</div>
						<p className="text-xs leading-relaxed">{p.personality}</p>
					</div>
				)}
				<div className="rounded-lg border bg-muted/30 p-3">
					<div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
						病案
					</div>
					<p className="text-xs leading-relaxed">{p.caseTitle || "未提供"}</p>
				</div>
			</div>
		</div>
	);
}
