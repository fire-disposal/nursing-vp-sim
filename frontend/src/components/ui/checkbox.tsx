import { Checkbox as MantineCheckbox, type CheckboxProps } from "@mantine/core";
import type * as React from "react";

type CheckboxProps2 = Omit<CheckboxProps & React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
	onCheckedChange?: (checked: boolean) => void;
	onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

function Checkbox({ onCheckedChange, onChange, ...props }: CheckboxProps2) {
	return (
		<MantineCheckbox
			onChange={onCheckedChange ? (e) => onCheckedChange(e.currentTarget.checked) : onChange}
			{...props}
		/>
	);
}

export { Checkbox };
