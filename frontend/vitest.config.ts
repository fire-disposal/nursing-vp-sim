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
		/**
		 * 依赖预打包：这套用例每个文件平均要为 Mantine/图标/路由重新走一遍 Vite 转换
		 * （单文件实测 import≈2.4s），107 个文件合计 3–4 分钟纯导入开销。预打包后
		 * 依赖只处理一次、之后走缓存，导入变成一次动态 import。
		 *
		 * 明确列出清单（不靠自动发现）：React 及 Mantine 各包必须与运行时同一份实例，
		 * 见 vite.config.ts 里 dedupe 的注释（两份 context 会崩成「MantineProvider not found」）。
		 */
		deps: {
			optimizer: {
				// Vitest 4 的键名是环境名（client/ssr），不是 vite 的 `web`
				client: {
					enabled: true,
					include: [
						"react",
						"react-dom",
						"react-dom/client",
						"react-router-dom",
						"@tanstack/react-query",
						"@mantine/core",
						"@mantine/dates",
						"@mantine/form",
						"@mantine/hooks",
						"@mantine/modals",
						"@mantine/notifications",
						"@mantine/spotlight",
						"@tabler/icons-react",
					],
				},
			},
		},
		/**
		 * 逐文件开销是固定成本（jsdom + 导入），并行度只影响墙钟：默认 workers ≈ 核数-1
		 * 会把 8 核机器打满（实测 load≈18）、内存翻倍。这里默认压到 4 个 worker，
		 * 保持机器可用；CI 可以用 `VITEST_MAX_WORKERS=8 pnpm test:frontend` 加回来。
		 */
		minWorkers: 1,
		maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4),
	},
});
