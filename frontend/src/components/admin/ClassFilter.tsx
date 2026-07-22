import { useState } from "react";
import { useClassesQuery, useGradesQuery } from "@/hooks/useGradesClasses";
import { cn } from "@/utils/cn";

interface ClassFilterParams {
	grade_id: number | null;
	class_id: number | null;
}

interface ClassFilterProps {
	gradeId?: number;
	classId?: number;
	onChange?: (params: ClassFilterParams) => void;
	className?: string;
}

const selectClass =
	"py-1.5 px-2.5 border border-border rounded-lg text-sm bg-card";

export default function ClassFilter({
	gradeId,
	classId,
	onChange,
	className = "",
}: ClassFilterProps) {
	const [selGrade, setSelGrade] = useState<string>(
		gradeId != null ? String(gradeId) : "",
	);
	const [selClass, setSelClass] = useState<string>(
		classId != null ? String(classId) : "",
	);
	const { data: grades = [] } = useGradesQuery();
	const { data: classes = [] } = useClassesQuery(
		selGrade ? Number(selGrade) : undefined,
	);

	const handleGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const gid = e.target.value;
		setSelGrade(gid);
		setSelClass("");
		onChange?.({
			grade_id: gid ? Number(gid) : null,
			class_id: null,
		});
	};

	const handleClassChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const cid = e.target.value;
		setSelClass(cid);
		onChange?.({
			grade_id: selGrade ? Number(selGrade) : null,
			class_id: cid ? Number(cid) : null,
		});
	};

	return (
		<div className={cn("flex gap-2 items-center", className)}>
			<select
				value={selGrade}
				onChange={handleGradeChange}
				className={selectClass}
			>
				<option value="">全部年级</option>
				{grades.map((g) => (
					<option key={g.id} value={g.id}>
						{g.name}
					</option>
				))}
			</select>
			<select
				value={selClass}
				onChange={handleClassChange}
				disabled={!selGrade}
				className={selectClass}
			>
				<option value="">全部班级</option>
				{classes.map((c) => (
					<option key={c.id} value={c.id}>
						{c.name}
					</option>
				))}
			</select>
		</div>
	);
}
