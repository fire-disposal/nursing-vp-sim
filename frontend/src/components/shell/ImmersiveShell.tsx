/**
 * ImmersiveShell — 训练沉浸壳
 *
 * 用于训练页（/training/:recordId）。
 * 零 Chrome，无导航，不渲染任何额外元素。
 * 子组件（TrainingEngine）完全控制视口。
 */
import type { ReactNode } from "react";

export default function ImmersiveShell({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
