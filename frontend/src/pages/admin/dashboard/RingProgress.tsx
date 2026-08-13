import { RingProgress as MantineRingProgress, Stack, Text } from "@mantine/core";

interface RingProgressProps {
	value: number;
	max: number;
	label: string;
	subtitle?: string;
	size?: number;
	strokeWidth?: number;
	className?: string;
}

function ringColor(pct: number): string {
	if (pct >= 80) return "green";
	if (pct >= 60) return "gray";
	return "red";
}

export function RingProgress({
	value,
	max,
	label,
	subtitle,
	size = 100,
	strokeWidth = 8,
	className,
}: RingProgressProps) {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0;

	return (
		<Stack align="center" gap={8} className={className}>
			<MantineRingProgress
				size={size}
				thickness={strokeWidth}
				roundCaps
				sections={[{ value: pct, color: ringColor(pct) }]}
				label={
					<Text size="xl" fw={700} ta="center" c={ringColor(pct)}>
						{pct}%
					</Text>
				}
			/>
			<Text size="xs" c="dimmed" ta="center" lh={1.3}>
				{label}
			</Text>
			{subtitle && (
				<Text size="xs" c="dimmed" ta="center" mt={2}>
					{subtitle}
				</Text>
			)}
		</Stack>
	);
}
