export interface ChartTooltipPayloadItem {
	color?: string;
	name?: string;
	value?: number;
}

interface ChartTooltipProps {
	active?: boolean;
	payload?: ChartTooltipPayloadItem[];
	label?: string;
	unit?: string;
	unitMap?: Record<string, string>;
}

export function ChartTooltip({
	active,
	payload,
	label,
	unit,
	unitMap,
}: ChartTooltipProps) {
	if (!active || !payload?.length) return null;

	return (
		<div className="bg-background border border-border rounded-lg px-3.5 py-2.5 shadow-md">
			{label && (
				<div className="text-xs text-muted-foreground mb-1">{label}</div>
			)}
			{payload.map((p, i) => {
				const u =
					unitMap?.[p.name ?? ""] ??
					unit ??
					(p.name?.includes("分") ? "分" : p.name?.includes("得分") ? "分" : "");
				return (
					<div
						key={i}
						className="text-sm"
						style={{ color: p.color ?? "var(--foreground)" }}
					>
						{p.name}: <strong>{p.value}{u}</strong>
					</div>
				);
			})}
		</div>
	);
}
