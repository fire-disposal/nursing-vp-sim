import { useEffect, useRef, useState } from "react";
import useGradesClassesStore from "../../stores/gradesClassesStore";

interface ClassFilterProps {
  gradeId?: string;
  classId?: string;
  onChange?: (params: { grade_id: string | null; class_id: number | null }) => void;
  className?: string;
}

export default function ClassFilter({ gradeId, classId, onChange, className = "" }: ClassFilterProps) {
  const { grades, classes, fetchGrades, fetchClasses } = useGradesClassesStore();
  const [selGrade, setSelGrade] = useState(gradeId || "");
  const [selClass, setSelClass] = useState(classId || "");
  const firstRun = useRef(true);

  useEffect(() => {
    fetchGrades();
  }, []);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    onChange?.({ grade_id: selGrade || null, class_id: null });
    setSelClass("");
  }, [selGrade]);

  const handleGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const gid = e.target.value;
    setSelGrade(gid);
    if (gid) {
      fetchClasses(Number(gid));
    }
  };

  const handleClassChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cid = e.target.value;
    setSelClass(cid);
    onChange?.({ grade_id: selGrade || null, class_id: cid ? Number(cid) : null });
  };

  return (
    <div className={`class-filter ${className}`} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <select
        value={selGrade}
        onChange={handleGradeChange}
        className="filter-select"
        style={{
          padding: "7px 10px",
          border: "1px solid var(--gray-200)",
          borderRadius: "var(--radius-md)",
          fontSize: "0.82rem",
          fontFamily: "inherit",
          background: "#fff",
        }}
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
        className="filter-select"
        disabled={!selGrade}
        style={{
          padding: "7px 10px",
          border: "1px solid var(--gray-200)",
          borderRadius: "var(--radius-md)",
          fontSize: "0.82rem",
          fontFamily: "inherit",
          background: "#fff",
        }}
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
