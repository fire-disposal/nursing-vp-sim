import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import useGradesClassesStore from "@/stores/gradesClassesStore";

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
	const { grades, classes, fetchGrades, fetchClasses } = useGradesClassesStore(
		useShallow((s) => ({
			grades: s.grades,
			classes: s.classes,
			fetchGrades: s.fetchGrades,
			fetchClasses: s.fetchClasses,
		})),
	);
	const [selGrade, setSelGrade] = useState<string>(
		gradeId != null ? String(gradeId) : "",
	);
	const [selClass, setSelClass] = useState<string>(
		classId != null ? String(classId) : "",
	);

	useEffect(() => {
		fetchGrades();
	}, [fetchGrades]);

	const handleGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const gid = e.target.value;
		setSelGrade(gid);
		setSelClass("");
		if (gid) {
			fetchClasses(Number(gid));
		}
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
