import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

/** 测试专用 render：包裹 MantineProvider + ModalsProvider + Notifications。 */
function AllProviders({ children }: { children: ReactNode }) {
	return (
		<MantineProvider defaultColorScheme="light">
			<ModalsProvider>
				<Notifications />
				{children}
			</ModalsProvider>
		</MantineProvider>
	);
}

function render(ui: ReactElement, options?: RenderOptions) {
	return rtlRender(ui, { wrapper: AllProviders, ...options });
}

export * from "@testing-library/react";
export { render };
