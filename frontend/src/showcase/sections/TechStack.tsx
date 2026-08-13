import { Box, Group, Text } from "@mantine/core";
import { TECH_STACK } from "../data";

export default function TechStack() {
	return (
		<Box
			component="section"
			py={40}
			style={{
				borderTop: "1px solid var(--mantine-color-default-border)",
				borderBottom: "1px solid var(--mantine-color-default-border)",
			}}
		>
			<Box
				pos="relative"
				style={{
					overflow: "hidden",
					maskImage:
						"linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
				}}
			>
				<Group
					wrap="nowrap"
					gap={0}
					style={{
						width: "max-content",
						animation: "marquee-third 42s linear infinite",
					}}
				>
					{[0, 1, 2].map((groupIndex) => (
						<Group
							key={groupIndex}
							wrap="nowrap"
							gap={40}
							pr={40}
							style={{ flexShrink: 0 }}
						>
							{TECH_STACK.map((t) => (
								<Text
									key={`${groupIndex}-${t}`}
									style={{ whiteSpace: "nowrap" }}
									size="sm"
									fw={500}
									c="dimmed"
								>
									{t}
								</Text>
							))}
						</Group>
					))}
				</Group>
			</Box>
		</Box>
	);
}
