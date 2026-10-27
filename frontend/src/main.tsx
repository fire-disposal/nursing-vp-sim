// 必须最先引入：垫片要早于 React/Mantine/懒加载 chunk 求值，详见 utils/polyfills.ts。
import "./utils/polyfills";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/dates/styles.css";
import { colorsTuple, MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import "dayjs/locale/zh-cn";
import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useActiveSchoolBrand } from "./hooks/useActiveSchoolBrand";
import { cssVariablesResolver, theme } from "./theme";
import { schoolPalette } from "./theme/school-palettes";
import { installChunkRecovery } from "./utils/chunk-recovery";
import "./styles/global.css";
import "@/styles/student.css";

// chunk 加载失败的有界自恢复：同一构建同一标签页最多自动刷新一次，
// 接口请求失败不刷新，额度用尽后交给 ErrorBoundary 显示可恢复错误。
// 详见 utils/chunk-recovery.ts。
installChunkRecovery();

function Root() {
	// 院校品牌色（可选）：换院校即换主色，学生/教师/平台都能一眼认出"现在在谁的语境里"。
	// 只影响观感，隔离仍由服务端租户作用域决定。
	const { school } = useActiveSchoolBrand();
	const activeTheme = useMemo(() => {
		const palette = schoolPalette(school?.themeColor);
		if (!palette) return theme;
		return { ...theme, colors: { ...theme.colors, brand: colorsTuple([...palette.shades]) } };
	}, [school?.themeColor]);

	return (
		<MantineProvider
			theme={activeTheme}
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
