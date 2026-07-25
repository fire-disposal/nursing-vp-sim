import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	server: {
		port: 3000,
		proxy: {
			"/api": {
				target: "http://localhost:8000",
				changeOrigin: true,
				ws: true,
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
					if (id.includes("node_modules/lucide-react")) return "icons";
					if (id.includes("node_modules/recharts")) return "charts";
					if (
						id.includes("node_modules/react-markdown") ||
						id.includes("node_modules/remark-gfm")
					)
						return "markdown";
					if (id.includes("node_modules/zustand")) return "vendor";
					if (id.includes("node_modules/@radix-ui")) return "vendor";
					if (id.includes("node_modules/@tanstack")) return "vendor";
				},
			},
		},
	},
});
