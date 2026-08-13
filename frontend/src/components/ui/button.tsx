import { Button as MantineButton, type ButtonProps } from "@mantine/core";
import type * as React from "react";

type Variant =
	| "default"
	| "outline"
	| "secondary"
	| "ghost"
	| "destructive"
	| "link"
	| "success"
	| "warning"
	| "info"
	| "abandon"
	| "end";
type Size = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

const VARIANTS: Record<Variant, { variant: ButtonProps["variant"]; color?: string }> = {
	default: { variant: "filled" },
	outline: { variant: "outline" },
	secondary: { variant: "light", color: "gray" },
	ghost: { variant: "subtle", color: "gray" },
	destructive: { variant: "light", color: "red" },
	link: { variant: "transparent" },
	success: { variant: "light", color: "green" },
	warning: { variant: "light", color: "yellow" },
	info: { variant: "light", color: "blue" },
	abandon: { variant: "light", color: "orange" },
	end: { variant: "light", color: "indigo" },
};

const SIZES: Partial<Record<Size, string>> = {
	default: "md",
	xs: "xs",
	sm: "sm",
	lg: "lg",
};

const ICON_SIZES: Partial<Record<Size, number>> = {
	icon: 44,
	"icon-xs": 32,
	"icon-sm": 36,
	"icon-lg": 48,
};

export interface ButtonProps2
	extends Omit<ButtonProps & React.ButtonHTMLAttributes<HTMLButtonElement>, "variant" | "size" | "color"> {
	variant?: Variant;
	size?: Size;
	color?: string;
}

function Button({ variant = "default", size = "default", className, children, ...props }: ButtonProps2) {
	const v = VARIANTS[variant];
	const iconSize = ICON_SIZES[size];
	const mantineSize = SIZES[size] ?? "md";

	if (iconSize != null) {
		return (
			<MantineButton
				size={mantineSize}
				variant={v.variant}
				color={v.color}
				w={iconSize}
				h={iconSize}
				p={0}
				className={className}
				{...props}
			>
				{children}
			</MantineButton>
		);
	}

	return (
		<MantineButton size={mantineSize} variant={v.variant} color={v.color} className={className} {...props}>
			{children}
		</MantineButton>
	);
}

export { Button };
export default Button;
