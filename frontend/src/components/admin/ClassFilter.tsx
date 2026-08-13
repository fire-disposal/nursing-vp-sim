import { Group, Select } from "@mantine/core";
import { useState } from "react";
import { useClassesQuery, useGradesQuery } from "@/hooks/useGradesClasses";

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
  className,
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

  const handleGradeChange = (value: string | null) => {
    const v = value === "all" ? "" : (value ?? "");
    setSelGrade(v);
    setSelClass("");
    onChange?.({
      grade_id: v ? Number(v) : null,
      class_id: null,
    });
  };

  const handleClassChange = (value: string | null) => {
    const v = value === "all" ? "" : (value ?? "");
    setSelClass(v);
    onChange?.({
      grade_id: selGrade ? Number(selGrade) : null,
      class_id: v ? Number(v) : null,
    });
  };

  return (
    <Group gap={8} className={className}>
      <Select
        value={selGrade || "all"}
        onChange={handleGradeChange}
        data={[
          { value: "all", label: "全部年级" },
          ...grades.map((g: { id: number; name: string }) => ({
            value: String(g.id),
            label: g.name,
          })),
        ]}
        placeholder="全部年级"
        size="sm"
        style={{ width: 130 }}
      />
      <Select
        value={selClass || "all"}
        onChange={handleClassChange}
        data={[
          { value: "all", label: "全部班级" },
          ...classes.map((c: { id: number; name: string }) => ({
            value: String(c.id),
            label: c.name,
          })),
        ]}
        placeholder="全部班级"
        size="sm"
        disabled={!selGrade}
        style={{ width: 130 }}
      />
    </Group>
  );
}
