import { Paper, Text } from "@mantine/core";

export interface ChartTooltipPayloadItem {
	color?: string;
	name?: string;
	value?: number;
}

interface ChartTooltipProps {
	active?: boolean;
	payload?: ChartTooltipPayloadItem[];
	label?: string;
	unit?: string;
	unitMap?: Record<string, string>;
}

export function ChartTooltip({
	active,
	payload,
	label,
	unit,
	unitMap,
}: ChartTooltipProps) {
	if (!active || !payload?.length) return null;

	return (
		<Paper shadow="sm" radius="md" px="md" py="sm" withBorder>
			{label && (
				<Text size="xs" c="dimmed" mb={4}>
					{label}
				</Text>
			)}
			{payload.map((p, i) => {
				const u =
					unitMap?.[p.name ?? ""] ??
					unit ??
					(p.name?.includes("分") ? "分" : "");
				return (
					<Text key={i} size="sm" c={p.color ?? undefined}>
						{p.name}: <strong>{p.value}{u}</strong>
					</Text>
				);
			})}
		</Paper>
	);
}
