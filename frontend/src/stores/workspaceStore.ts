/**
 * 工作区局部 UI 状态（docs/15 §十三：Zustand 只保留会话瞬态）。
 *
 * 这里**只有**「哪个面板处于展开状态」——不持有任何会话/业务状态：
 * 可用性、完成条件、产物状态全部读 manifest，业务数据走 query cache。
 * 桌面侧栏与移动底部面板共用这份状态，切换断点不会丢面板。
 */
import { create } from "zustand";

/** 内置面板 id：问诊清单（非 Activity，见 workspace/contract.ts） */
export const INQUIRY_PANEL_ID = "inquiry";

/** 病例挂了随堂测验时默认展开的面板 id */
export const QUIZ_PANEL_ID = "quiz";

interface WorkspaceState {
	/** 展开的面板 id：manifest activity id 或内置面板 id */
	openPanelId: string | null;
	/** 默认展开是否已应用（学生手动收起后不再重开） */
	initialPanelApplied: boolean;
	openPanel: (id: string) => void;
	closePanel: () => void;
	togglePanel: (id: string) => void;
	/** 会话装配时的默认展开：每次会话只生效一次 */
	applyInitialPanel: (id: string) => void;
	/** 换会话：清空展开状态与默认标记 */
	resetWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
	openPanelId: null,
	initialPanelApplied: false,
	openPanel: (id) => set({ openPanelId: id }),
	closePanel: () => set({ openPanelId: null }),
	togglePanel: (id) => set((state) => ({ openPanelId: state.openPanelId === id ? null : id })),
	applyInitialPanel: (id) =>
		set((state) => (state.initialPanelApplied ? {} : { openPanelId: id, initialPanelApplied: true })),
	resetWorkspace: () => set({ openPanelId: null, initialPanelApplied: false }),
}));
