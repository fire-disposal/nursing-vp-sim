import { Group, Select } from "@mantine/core";
import { useState } from "react";
import { useClassesQuery, useCohortLabels } from "@/hooks/useClasses";

export interface ClassFilterParams {
	/** 届/年级标签精确过滤（null = 不限）。 */
	cohort_label: string | null;
	/** 具体班级（null = 该届全部）。 */
	class_id: number | null;
}

interface ClassFilterProps {
	cohortLabel?: string | null;
	classId?: number;
	onChange?: (params: ClassFilterParams) => void;
	className?: string;
}

/**
 * 届别 + 班级两级筛选。
 * 班级下拉按届别收窄；未选届别时列出全部班级并标注其届别，避免同名班级无法分辨。
 */
export default function ClassFilter({
	cohortLabel,
	classId,
	onChange,
	className,
}: ClassFilterProps) {
	const [selCohort, setSelCohort] = useState<string>(cohortLabel ?? "");
	const [selClass, setSelClass] = useState<string>(
		classId != null ? String(classId) : "",
	);
	const { labels: cohortLabels } = useCohortLabels();
	const { data: classes = [] } = useClassesQuery(selCohort || null);

	const handleCohortChange = (value: string | null) => {
		const next = value === "all" ? "" : (value ?? "");
		setSelCohort(next);
		setSelClass("");
		onChange?.({ cohort_label: next || null, class_id: null });
	};

	const handleClassChange = (value: string | null) => {
		const next = value === "all" ? "" : (value ?? "");
		setSelClass(next);
		onChange?.({
			cohort_label: selCohort || null,
			class_id: next ? Number(next) : null,
		});
	};

	return (
		<Group gap={8} className={className} wrap="nowrap">
			<Select
				value={selCohort || "all"}
				onChange={handleCohortChange}
				data={[
					{ value: "all", label: "全部届别" },
					...cohortLabels.map((label) => ({ value: label, label })),
				]}
				placeholder="全部届别"
				aria-label="届别筛选"
				size="sm"
				style={{ width: 140 }}
			/>
			<Select
				value={selClass || "all"}
				onChange={handleClassChange}
				data={[
					{ value: "all", label: "全部班级" },
					...classes.map((c) => ({
						value: String(c.id),
						label: selCohort || !c.cohort_label ? c.name : `${c.cohort_label} ${c.name}`,
					})),
				]}
				placeholder="全部班级"
				aria-label="班级筛选"
				size="sm"
				style={{ width: 180 }}
			/>
		</Group>
	);
}
