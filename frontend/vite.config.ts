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
	},
	server: {
		port: 3000,
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
