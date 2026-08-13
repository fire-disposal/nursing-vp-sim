import { Divider, type DividerProps } from "@mantine/core";

function Separator({
	orientation = "horizontal",
	...props
}: Omit<DividerProps, "orientation"> & { orientation?: "horizontal" | "vertical" }) {
	return <Divider orientation={orientation} {...props} />;
}

export { Separator };
