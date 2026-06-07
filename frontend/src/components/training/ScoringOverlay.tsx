import { cn } from "@/lib/utils";

interface ScoringOverlayProps {
  progress: number;
  onCancel: () => void;
}

export default function ScoringOverlay({ progress, onCancel }: ScoringOverlayProps) {
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[200]">
      <div className="bg-card rounded-2xl text-center px-6 sm:px-10 py-8 sm:py-10 max-w-[420px] w-[92vw] shadow-xl border border-border">
        <div className="w-12 h-12 mx-auto mb-5 border-4 border-muted border-t-primary rounded-full animate-spin" />
        <h3 className="text-lg font-semibold mb-2">{progress >= 100 ? "评分完成，即将展示报告" : "AI 正在评分"}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">正在分析你的训练表现，根据问诊完整性、沟通技巧等维度进行评分，请耐心等待...</p>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-6">
          <div
            className={cn("h-full rounded-full transition-colors", progress >= 100 ? "bg-green-500" : "bg-primary")}
            style={{ width: `${progress}%`, transition: progress >= 100 ? "none" : "width 0.05s linear" }}
          />
        </div>
        <button onClick={onCancel} className="px-5 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm hover:bg-muted transition-colors">
          稍后在记录中查看，先回首页
        </button>
      </div>
    </div>
  );
}
