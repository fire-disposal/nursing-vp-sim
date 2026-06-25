import { Badge } from "@/components/ui/badge";
import { DIFFICULTY_LABELS } from "@/lib/styles";

type DifficultyVariant = "success" | "warning" | "danger" | "neutral";

const DIFFICULTY_VARIANT: Record<number, DifficultyVariant> = {
	1: "success",
	2: "warning",
	3: "danger",
};

/** Case difficulty pill — uses lib/styles labels as the single source of truth. */
export function DifficultyBadge({ level }: { level: number }) {
	return (
		<Badge variant={DIFFICULTY_VARIANT[level] ?? "neutral"}>
			{DIFFICULTY_LABELS[level] ?? "未知"}
		</Badge>
	);
}

export default DifficultyBadge;
