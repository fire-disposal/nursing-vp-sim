import type { ScenarioDim } from "@/api/scenario";

/** 维度读数：数值缺失就是缺失（后端会同时给出原因，不补零、不猜）。 */
function dimValue(value: unknown, unit: string): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "number") return unit ? `${value}${unit}` : String(value);
	return String(value);
}

/** 经历量化的单张卡片：侧栏与经历页共用（`dims` 是同一份投影）。 */
export default function DimCard({ dim }: { dim: ScenarioDim }) {
	return (
		<div className="sc-dim">
			<div className="sc-hud-label">{dim.label}</div>
			<div className="sc-dim-value">{dimValue(dim.value, dim.unit)}</div>
			<div className="sc-dim-detail">{dim.detail}</div>
		</div>
	);
}
