import { useEffect, useRef, useState } from "react";
import { getClasses, getGrades } from "../../api";

export default function ClassFilter({ gradeId, classId, onChange, className = "" }) {
  const [grades, setGrades] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selGrade, setSelGrade] = useState(gradeId || "");
  const [selClass, setSelClass] = useState(classId || "");
  const firstRun = useRef(true);

  useEffect(() => {
    getGrades()
      .then(setGrades)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    onChange?.({ grade_id: selGrade || null, class_id: null });
    setSelClass("");
    setClasses([]);
  }, [selGrade]);

  const handleGradeChange = (e) => {
    const gid = e.target.value;
    setSelGrade(gid);
    if (gid) {
      getClasses({ grade_id: Number(gid) })
        .then(setClasses)
        .catch(() => {});
    }
  };

  const handleClassChange = (e) => {
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
