import { lazy } from "react";
import type { ActivityRenderer } from "./contract";

/**
 * RendererMap（docs/15 §十三）——**纯映射**：`ui.renderer → 面板组件`。
 *
 * 纪律（docs/15 §十五 陷阱 1）：本表**不回答**「这个病例有没有某能力」。
 * 表里存在某个 renderer 不代表能力可用；可用性一律来自
 * `manifest.activities[].availability`，工作区只渲染服务端标为 available 的项。
 */
export const ACTIVITY_RENDERERS: Record<string, ActivityRenderer> = {
	physical_exam: lazy(() => import("../tools/PhysicalExamTool")),
	nursing_record: lazy(() => import("../tools/NursingRecordTool")),
	quiz: lazy(() => import("../tools/QuizTool")),
	nursing_diagnosis: lazy(() => import("../tools/NursingDiagnosisTool")),
};

/** 需要更宽面板的 renderer —— 纯布局分组，不是能力开关。 */
export const WIDE_ACTIVITY_RENDERERS: Record<string, true> = {
	physical_exam: true,
	nursing_record: true,
};

export const ACTIVITY_PANEL_WIDTH = { wide: 400, narrow: 300 } as const;
