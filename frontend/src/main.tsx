import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import {
	MantineProvider,
	useComputedColorScheme,
} from "@mantine/core";
import React, { useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createAppTheme } from "./theme";
import { useBrandStore } from "./theme/brand-store";
import "./styles/global.css";

// Chunk 加载失败恢复：新部署后浏览器缓存的 index.html 可能
// 引用已不存在的旧 chunk hash → 强制全量刷新。
// vite:preloadError 是 Vite 构建注入的事件（生产环境生效）。
window.addEventListener("vite:preloadError", () => {
	window.location.reload();
});
// 兜底：unhandledrejection 捕获未被 vite:preloadError 覆盖的
// 动态 import 失败场景。
window.addEventListener("unhandledrejection", (event) => {
	const msg = String(event.reason?.message ?? event.reason ?? "");
	if (msg.includes("dynamically imported module") || msg.includes("Failed to fetch")) {
		window.location.reload();
	}
});

/**
 * 过渡期：把 Mantine 的暗色解析结果同步到 `.dark` class，
 * 让尚未迁移的 Tailwind `dark:` 变体继续生效。Tailwind 移除后删除。
 */
function ColorSchemeClassSync() {
	const scheme = useComputedColorScheme("light");
	useEffect(() => {
		document.documentElement.classList.toggle("dark", scheme === "dark");
	}, [scheme]);
	return null;
}

function Root() {
	const brand = useBrandStore((s) => s.brand);
	const theme = useMemo(() => createAppTheme(brand), [brand]);
	return (
		<MantineProvider theme={theme} defaultColorScheme="auto">
			<ColorSchemeClassSync />
			<App />
		</MantineProvider>
	);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<Root />
	</React.StrictMode>,
);
