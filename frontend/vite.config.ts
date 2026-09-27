import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
		// 依赖去重：pnpm 的嵌套 node_modules 下同一个包可能被解析到两份物理路径，
		// 于是出现「Provider 与消费者各拿一份 context」这类隐性故障
		// （实测症状：整页崩 `MantineProvider was not found`，而代码毫无问题）。
		dedupe: [
			"react",
			"react-dom",
			"@mantine/core",
			"@mantine/dates",
			"@mantine/form",
			"@mantine/hooks",
			"@mantine/modals",
			"@mantine/notifications",
			"@mantine/spotlight",
		],
	},
	optimizeDeps: {
		// 显式声明入口：让这些包**各自**成为优化产物，彼此只能 externalize 引用，
		// 不会被内联进对方的 chunk。依赖发现顺序因此不再影响结果 —— 依赖缓存半新半旧
		// （上次优化被中断、或中途改了 import）也不会再产出两份实例。
		include: [
			"react",
			"react-dom",
			"react-dom/client",
			"@mantine/core",
			"@mantine/dates",
			"@mantine/form",
			"@mantine/hooks",
			"@mantine/modals",
			"@mantine/notifications",
			"@mantine/spotlight",
		],
	},
	server: {
		port: 3000,
		watch: {
			// 忽略编辑器/工具原子写产生的临时文件：Windows 上 Vite 监听它们
			// 会在 rename/删除瞬间触发 EBUSY 文件锁崩溃（见 .tmpdir 残留路径）
			ignored: [
				"**/.*.tmpdir/**",
				"**/*.tmp",
				"**/.*.swp",
				"**/*~",
			],
		},
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8000",
				changeOrigin: true,
				ws: true,
				proxyTimeout: 10_000, // 10s — backend down → 504 instead of hang
				timeout: 10_000,
				configure: (proxy) => {
					proxy.on("proxyReq", (_proxyReq, req) => {
						req.headers.host = "127.0.0.1:8000";
					});
				},
			},
		},
	},
	build: {
		// 浏览器下限（机房镜像为 Chromium 92）：语法的降级底线，API 由 utils/polyfills.ts 兜底。
		// 详见 docs/09-operations.md「浏览器下限」。
		target: ["chrome92", "edge92", "firefox91", "safari15"],
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (
						id.includes("node_modules/react-dom") ||
						id.includes("node_modules/react/")
					)
						return "vendor";
					if (id.includes("node_modules/react-router")) return "vendor";
					if (id.includes("node_modules/@mantine")) return "mantine";
					if (id.includes("node_modules/@tabler/icons-react")) return "icons";
					if (id.includes("node_modules/recharts")) return "charts";
					if (
						id.includes("node_modules/react-markdown") ||
						id.includes("node_modules/remark-gfm")
					)
						return "markdown";
					if (id.includes("node_modules/zustand")) return "vendor";
					if (id.includes("node_modules/@tanstack")) return "vendor";
					if (id.includes("node_modules/three") || id.includes("node_modules/@react-three"))
						return "three";
					if (id.includes("node_modules/@monaco-editor")) return "monaco";
				},
			},
		},
	},
});
