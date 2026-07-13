/**
 * DefaultShell — 通用导航壳
 *
 * 用于不需要底部 Tab 但需要返回导航的页面：
 *   /record/:id    — 训练结果详情
 *   /stats         — 训练统计
 *   /profile       — 个人中心
 *
 * 包含：
 *   - 轻量顶栏（44px）：返回按钮 + 页面标题
 *   - flex-1 内容区
 */
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const TITLE_MAP: Record<string, string> = {
	"/stats": "训练统计",
	"/profile": "个人中心",
};

function guessTitle(pathname: string): string {
	// 精确匹配
	if (TITLE_MAP[pathname]) return TITLE_MAP[pathname];
	// 模式匹配：/record/xxx → 训练结果
	if (pathname.startsWith("/record/")) return "训练结果";
	// 兜底
	return "";
}

export default function DefaultShell({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const location = useLocation();
	const title = guessTitle(location.pathname);

	const handleBack = () => {
		if (location.pathname.startsWith("/record/")) {
			navigate("/history");
		} else {
			navigate(-1);
		}
	};

	return (
		<div className="flex flex-col h-full">
			<header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3"
				style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
			>
				<button
					onClick={handleBack}
					className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
					aria-label="返回"
				>
					<ArrowLeft size={18} />
				</button>
				{title && (
					<span className="text-sm font-semibold truncate">{title}</span>
				)}
			</header>
			<div className="flex-1 overflow-y-auto">
				{children}
			</div>
		</div>
	);
}
