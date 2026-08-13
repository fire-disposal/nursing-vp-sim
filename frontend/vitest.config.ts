import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: { "@": path.resolve(__dirname, "src") },
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/__tests__/setup.ts"],
		globals: true,
		// Mantine 组件（如 autosize Textarea）在 jsdom 中渲染/输入较慢，放宽超时
		testTimeout: 20000,
		css: { modules: { classNameStrategy: "non-scoped" } },
	},
});
