import { Switch as MantineSwitch, type SwitchProps } from "@mantine/core";
import type * as React from "react";

type SwitchProps2 = Omit<SwitchProps & React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> & {
	size?: "sm" | "default";
	onCheckedChange?: (checked: boolean) => void;
	onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

function Switch({ size = "default", onCheckedChange, onChange, ...props }: SwitchProps2) {
	return (
		<MantineSwitch
			size={size === "sm" ? "sm" : "md"}
			onChange={onCheckedChange ? (e) => onCheckedChange(e.currentTarget.checked) : onChange}
			{...props}
		/>
	);
}

export { Switch };
