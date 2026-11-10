import { Box, Group, Text, VisuallyHidden } from "@mantine/core";
import { TECH_STACK } from "../data";
import { prefersReducedMotion } from "../gsap";

function TechLabel({ name }: { name: string }) {
	return (
		<Text style={{ whiteSpace: "nowrap" }} size="sm" fw={500} c="dimmed">
			{name}
		</Text>
	);
}

export default function TechStack() {
	const reducedMotion = prefersReducedMotion();

	return (
		<Box
			component="section"
			aria-label="技术栈"
			py={40}
			style={{
				borderTop: "1px solid var(--mantine-color-default-border)",
				borderBottom: "1px solid var(--mantine-color-default-border)",
			}}
		>
			<VisuallyHidden>{TECH_STACK.join("、")}</VisuallyHidden>
			{reducedMotion ? (
				<Group aria-hidden="true" wrap="wrap" justify="center" gap="md" px="md">
					{TECH_STACK.map((name) => (
						<TechLabel key={name} name={name} />
					))}
				</Group>
			) : (
				<Box
					aria-hidden="true"
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
								{TECH_STACK.map((name) => (
									<TechLabel key={`${groupIndex}-${name}`} name={name} />
								))}
							</Group>
						))}
					</Group>
				</Box>
			)}
		</Box>
	);
}
