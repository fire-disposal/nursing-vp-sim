import { Stack, Text, Title } from "@mantine/core";

interface SectionHeadingProps {
	eyebrow?: string;
	title: string;
	mb?: number | string;
}

export default function SectionHeading({
	eyebrow,
	title,
	mb,
}: SectionHeadingProps) {
	return (
		<Stack gap={8} mb={mb}>
			{eyebrow ? (
				<Text
					size="11px"
					fw={600}
					tt="uppercase"
					c="var(--mantine-primary-color-6)"
					style={{ letterSpacing: "0.22em" }}
				>
					{eyebrow}
				</Text>
			) : null}
			<Title order={2} fw={700}>
				{title}
			</Title>
		</Stack>
	);
}
