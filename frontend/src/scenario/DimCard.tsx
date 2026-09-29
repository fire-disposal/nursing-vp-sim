import type { ScenarioDim } from "@/api/scenario";

/** 维度读数：数值缺失就是缺失（后端会同时给出原因，不补零、不猜）。 */
function dimValue(value: number | null | undefined): string {
	if (value === null || value === undefined) return "—";
	return String(value);
}

/**
 * 经历量化的单行读数：**标签 + 数值 + 单位**同行对齐（数值等宽、字号不超过正文）。
 *
 * **不渲染 `dim.detail`**：后端那条 `detail` 是判读口径，串里带的是内部字段名
 * （`scene.spo2 初值 88 → 当前 88` 这类），属于「诊断串不进学生可见面」管辖；
 * 前端不做字符串改写（改写了也会随后端漂移）。管理侧取证要看它，由管理侧组件自己渲染。
 */
export default function DimCard({ dim }: { dim: ScenarioDim }) {
	return (
		<div className="sc-dim">
			<span>{dim.label}</span>
			<span className="sc-dim-body">
				<span className="sc-dim-value">{dimValue(dim.value)}</span>
				{dim.unit !== "" && <span className="sc-dim-unit">{dim.unit}</span>}
			</span>
		</div>
	);
}
