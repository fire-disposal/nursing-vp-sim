import { Box, Card as MantineCard, Text, type CardProps, type TextProps } from "@mantine/core";
import type * as React from "react";

type CardProps2 = CardProps & React.HTMLAttributes<HTMLDivElement> & { size?: "default" | "sm" };

function Card({ className, size = "default", ...props }: CardProps2) {
	return (
		<MantineCard
			withBorder
			radius="md"
			padding={size === "sm" ? "md" : "lg"}
			className={className}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <Box className={className} mb="xs" {...props} />;
}

function CardTitle({ className, ...props }: TextProps & { children?: React.ReactNode }) {
	return <Text fw={600} size="md" lh={1.35} className={className} {...props} />;
}

function CardDescription({ className, ...props }: TextProps & { children?: React.ReactNode }) {
	return <Text size="sm" c="dimmed" className={className} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return <Box className={className} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <Box className={className} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return <Box className={className} mt="sm" {...props} />;
}

export {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
};
