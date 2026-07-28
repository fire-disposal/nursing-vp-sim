import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClassesQuery, useGradesQuery } from "@/hooks/useGradesClasses";
import { cn } from "@/lib/utils";

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

  const handleGradeChange = (value: string) => {
    setSelGrade(value);
    setSelClass("");
    onChange?.({
      grade_id: value ? Number(value) : null,
      class_id: null,
    });
  };

  const handleClassChange = (value: string) => {
    setSelClass(value);
    onChange?.({
      grade_id: selGrade ? Number(selGrade) : null,
      class_id: value ? Number(value) : null,
    });
  };

  return (
    <div className={cn("flex gap-2 items-center", className)}>
      <Select value={selGrade || "all"} onValueChange={(v) => handleGradeChange(v === "all" ? "" : v ?? "")}>
        <SelectTrigger className="h-9 w-[130px] text-sm">
          <SelectValue placeholder="全部年级" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部年级</SelectItem>
          {grades.map((g: { id: number; name: string }) => (
            <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selClass || "all"} onValueChange={(v) => handleClassChange(v === "all" ? "" : v ?? "")} disabled={!selGrade}>
        <SelectTrigger className="h-9 w-[130px] text-sm">
          <SelectValue placeholder="全部班级" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部班级</SelectItem>
          {classes.map((c: { id: number; name: string }) => (
            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
