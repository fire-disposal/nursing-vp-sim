import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import { MantineProvider } from "@mantine/core";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { theme } from "./theme";
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

function Root() {
	return (
		<MantineProvider theme={theme} defaultColorScheme="light">
			<App />
		</MantineProvider>
	);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<Root />
	</React.StrictMode>,
);
