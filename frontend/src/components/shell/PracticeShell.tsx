import { Box } from "@mantine/core";
import type { ReactNode } from "react";
import ShellTransition from "./ShellTransition";

/**
 * PracticeShell — 训练沉浸壳
 */
export default function PracticeShell({ children }: { children: ReactNode }) {
	return (
		<Box pos="relative">
			<ShellTransition>{children}</ShellTransition>
		</Box>
	);
}
