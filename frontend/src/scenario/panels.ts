/** pack 声明的呈现面板（后端 `PanelType` 的封闭三值）。 */
export type ScenarioPanel = "timeline" | "emotion" | "coverage";

/** 侧栏/经历页各区块是否展示。 */
export type ScenarioPanelFlags = Record<ScenarioPanel, boolean>;

/**
 * `view.panels` → 各区块开关。
 *
 * 映射（后端只给面板名，内容由视图投影决定）：
 * - `timeline` → 经历时间线（侧栏 / 经历页）
 * - `emotion` → 经历量化读数（`dims`：本轨的"经历量化"投影）
 * - `coverage` → 现场与线索（已揭示 / 你注意到的，即覆盖地图）
 *
 * **未声明（空数组）时一律全开**：老 pack 没写 `panels` 不代表它不要面板，
 * 只在作者显式声明时才按声明收窄。
 */
export function resolvePanels(panels: string[] | undefined): ScenarioPanelFlags {
	if (!panels || panels.length === 0) {
		return { timeline: true, emotion: true, coverage: true };
	}
	return {
		timeline: panels.includes("timeline"),
		emotion: panels.includes("emotion"),
		coverage: panels.includes("coverage"),
	};
}
