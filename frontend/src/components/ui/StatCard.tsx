import { type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatColor = "blue" | "green" | "amber" | "red" | "teal";

const colorClasses: Record<StatColor, { bg: string; color: string }> = {
  blue: { bg: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400", color: "" },
  green: { bg: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400", color: "" },
  amber: { bg: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400", color: "" },
  red: { bg: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400", color: "" },
  teal: { bg: "bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400", color: "" },
};

interface StatCardProps {
  icon?: ElementType;
  value?: ReactNode;
  label: string;
  color?: StatColor;
  trend?: number;
  onClick?: () => void;
  className?: string;
}

export default function StatCard({ icon: Icon, value, label, color = "blue", trend, onClick, className }: StatCardProps) {
  const c = colorClasses[color] || colorClasses.blue;

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all",
        onClick && "cursor-pointer hover:border-primary hover:shadow-sm",
        className,
      )}
    >
      {Icon && (
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", c.bg)}>
          <Icon size={20} />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xl font-bold leading-tight text-foreground">{value ?? "-"}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">{label}</div>
        {trend !== undefined && trend !== 0 && (
          <div className={cn("mt-0.5 text-xs font-medium", trend > 0 ? "text-green-600" : "text-red-600")}>
            {trend > 0 ? "\u2191" : "\u2193"} {Math.abs(trend)}%
          </div>
        )}
      </div>
    </div>
  );
}
