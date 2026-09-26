// 必须最先引入：垫片要早于 React/Mantine/懒加载 chunk 求值，详见 utils/polyfills.ts。
import "./utils/polyfills";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/dates/styles.css";
import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import "dayjs/locale/zh-cn";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { cssVariablesResolver, theme } from "./theme";
import { installChunkRecovery } from "./utils/chunk-recovery";
import "./styles/global.css";

// chunk 加载失败的有界自恢复：同一构建同一标签页最多自动刷新一次，
// 接口请求失败不刷新，额度用尽后交给 ErrorBoundary 显示可恢复错误。
// 详见 utils/chunk-recovery.ts。
installChunkRecovery();

function Root() {
	return (
		<MantineProvider
			theme={theme}
			defaultColorScheme="light"
			cssVariablesResolver={cssVariablesResolver}
		>
			<DatesProvider settings={{ locale: "zh-cn", firstDayOfWeek: 1 }}>
				<App />
			</DatesProvider>
		</MantineProvider>
	);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<Root />
	</React.StrictMode>,
);
