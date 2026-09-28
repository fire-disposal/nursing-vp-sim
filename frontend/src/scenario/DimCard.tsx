import { useEffect, useRef, useState } from "react";
import type { ScenarioDim } from "@/api/scenario";

/** 维度读数：数值缺失就是缺失（后端会同时给出原因，不补零、不猜）。 */
function dimValue(value: unknown): string {
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

/**
 * 顶栏进度：把"经历量化"压成**一条细进度 + 数字**（顶栏保持一行高度）。
 *
 * - 只挑两类能量化的读数：比例（`unit === "比例"`，0–1）与次数（`unit === "次"`）；
 *   本情境没有这两类就不渲染（不占位、不留空条）。
 * - 全部读数（含细节）在点击展开的弹层里，信息不丢；点外面或 Esc 收起。
 * - 弹层是自建的（不用 Mantine Popover）：控制台整体自建组件。
 */
export function ScenarioProgress({ dims }: { dims: ScenarioDim[] }) {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const ratio = dims.find(
		(dim) => dim.unit === "比例" && typeof dim.value === "number",
	);
	const count = dims.find(
		(dim) => dim.unit === "次" && typeof dim.value === "number",
	);
	if (ratio === undefined && count === undefined) return null;
	const fraction = ratio === undefined ? 0 : Math.min(1, Math.max(0, ratio.value as number));

	return (
		<section
			className="sc-progress-wrap"
			aria-label="经历量化"
			ref={wrapRef}
		>
			<button
				type="button"
				className="sc-progress"
				aria-expanded={open}
				aria-controls="sc-progress-panel"
				onClick={() => setOpen((value) => !value)}
			>
				{ratio !== undefined && (
					<>
						<span className="sc-progress-label">{ratio.label}</span>
						<span className="sc-progress-value">
							{Math.round(fraction * 100)}%
						</span>
						{/* 0% 不是"一条分隔线"：条本身很窄，且未开始时给一段可见的起点标记 */}
						<span className="sc-progress-bar" data-empty={fraction === 0}>
							<span
								className="sc-progress-fill"
								// 0% 不设宽度：由样式给出"起点标记"，这样它不是一条隐形分隔线
								style={
									fraction === 0
										? undefined
										: { width: `${Math.round(fraction * 100)}%` }
								}
							/>
						</span>
					</>
				)}
				{count !== undefined && (
					<span
						className="sc-progress-value sc-progress-count"
						/* 窄屏：已经有比例那条细进度时，次数让位（页头只有一行，夹断半个字不如不给；
						   两个读数与全部细节都在点开的弹层里，一个都不少）。
						   没有比例可比时才留着——否则窄屏的进度会变成一个空按钮。 */
						data-narrow-hide={ratio !== undefined ? "true" : undefined}
					>
						{count.label} {dimValue(count.value)}
						{count.unit}
					</span>
				)}
			</button>
			{open && (
				<div className="sc-progress-panel" id="sc-progress-panel">
					<div className="sc-progress-detail">
						{dims.map((dim) => (
							<DimCard dim={dim} key={dim.id} />
						))}
					</div>
				</div>
			)}
		</section>
	);
}
