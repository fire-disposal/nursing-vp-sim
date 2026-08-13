import { Badge as MantineBadge, type BadgeProps } from "@mantine/core";
import type * as React from "react";

type Variant =
	| "default"
	| "secondary"
	| "destructive"
	| "outline"
	| "ghost"
	| "link"
	| "success"
	| "info"
	| "warning"
	| "danger"
	| "neutral";

const VARIANTS: Record<Variant, { variant: BadgeProps["variant"]; color?: string }> = {
	default: { variant: "filled" },
	secondary: { variant: "light", color: "gray" },
	destructive: { variant: "light", color: "red" },
	outline: { variant: "outline" },
	ghost: { variant: "subtle" },
	link: { variant: "transparent" },
	success: { variant: "light", color: "green" },
	info: { variant: "light", color: "blue" },
	warning: { variant: "light", color: "yellow" },
	danger: { variant: "light", color: "red" },
	neutral: { variant: "light", color: "gray" },
};

type BadgeProps2 = Omit<BadgeProps & React.HTMLAttributes<HTMLDivElement>, "variant" | "color"> & {
	variant?: Variant;
	color?: string;
};

function Badge({ variant = "default", className, ...props }: BadgeProps2) {
	const v = VARIANTS[variant];
	return <MantineBadge variant={v.variant} color={v.color} className={className} {...props} />;
}

export { Badge };
export default Badge;
