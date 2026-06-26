import { useEffect, useState } from "react";
import { PatientPortrait } from "@/components/training/PatientPortrait";
import { useEmotion } from "@/engine";
import type { PanelTabProps } from "@/engine/types";

export function PatientInfoTab({ ctx, features }: PanelTabProps) {
	const p = ctx.patient;
	const { emotion } = useEmotion();
	const [trust, setTrust] = useState(50);
	const [comfort, setComfort] = useState(50);

	useEffect(() => {
		const unsub = ctx.bus.on(
			"emotion:changed",
			(data: { trust: number; comfort: number }) => {
				setTrust(data.trust);
				setComfort(data.comfort);
			},
		);
		return unsub;
	}, [ctx.bus]);

	if (!p) return null;

	return (
		<div className="space-y-4">
			<PatientPortrait
				patient={p}
				emotion={emotion}
				emotionEnabled={features?.emotion}
				trust={trust}
				comfort={comfort}
			/>
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
