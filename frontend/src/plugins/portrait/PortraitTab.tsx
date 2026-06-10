import { useEffect } from "react";
import type { EmotionState } from "@/engine/PluginContext";
import { EMOTION_LABELS, useEmotion, usePortrait } from "@/engine/PluginContext";
import type { PanelTabProps } from "@/engine/types";

const EMOTION_FILES: Record<EmotionState, string> = {
  withdrawn: "withdrawn.png",
  defensive: "defensive.png",
  neutral: "neutral.png",
  relaxed: "relaxed.png",
  open: "open.png",
};

export function PortraitTab({ ctx }: PanelTabProps) {
  const { portraitUrl, setPortraitUrl } = usePortrait();
  const { emotion } = useEmotion();

  useEffect(() => {
    const unsub = ctx.bus.on("emotion:changed", (data: { emotion: EmotionState }) => {
      const portraitUrl = `/portraits/${ctx.patient.caseTitle || "default"}/${EMOTION_FILES[data.emotion] || "neutral.png"}`;
      setPortraitUrl(portraitUrl);
    });
    return unsub;
  }, [ctx.bus, ctx.patient.caseTitle, setPortraitUrl]);

  return (
    <div className="space-y-4 text-center">
      {portraitUrl ? (
        <img
          src={portraitUrl}
          alt="患者立绘"
          loading="lazy"
          className="w-full max-w-[200px] mx-auto rounded-lg border bg-muted"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="w-full max-w-[200px] mx-auto aspect-square rounded-lg border bg-muted flex items-center justify-center">
          <span className="text-xs text-muted-foreground">暂无立绘素材</span>
        </div>
      )}
      <div>
        <p className="text-xs text-muted-foreground">当前表情：{EMOTION_LABELS[emotion]}</p>
        <p className="text-[0.65rem] text-muted-foreground/50 mt-1">
          素材路径：/public/portraits/{"{case_id}"}/{"{emotion}"}.png
        </p>
      </div>
    </div>
  );
}
