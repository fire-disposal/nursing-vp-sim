export interface MewsInput {
  hr?: number;
  sbp?: number;
  rr?: number;
  temp?: number;
  consciousness?: "alert" | "confused" | "lethargic" | "unresponsive";
}

export function calcMews(v: MewsInput): number {
  let s = 0;
  // 心率 HR: ≤40→3, ≤50→2, ≤70→1, ≤100→0, ≤110→1, ≤130→2, ≥131→3
  if (v.hr != null) s += v.hr <= 40 ? 3 : v.hr <= 50 ? 2 : v.hr <= 70 ? 1 : v.hr <= 100 ? 0 : v.hr <= 110 ? 1 : v.hr <= 130 ? 2 : 3;
  // 收缩压 SBP: ≤70→3, ≤80→2, ≤100→1, 101–199→0, ≥200→3
  if (v.sbp != null) s += v.sbp <= 70 ? 3 : v.sbp <= 80 ? 2 : v.sbp <= 100 ? 1 : v.sbp >= 200 ? 3 : 0;
  // 呼吸 RR: ≤8→3, 9–11→2, 12–15→0, 16–20→1, 21–25→2, ≥26→3
  if (v.rr != null) s += v.rr <= 8 || v.rr >= 26 ? 3 : v.rr <= 11 || v.rr >= 21 ? 2 : v.rr >= 16 ? 1 : 0;
  // 体温 TEMP: ≤35→2, 35.1–36→1, 36.1–38.5→0, 38.6–38.9→1, ≥39→2
  if (v.temp != null) s += v.temp <= 35 || v.temp >= 39 ? 2 : v.temp <= 36 || v.temp >= 38.5 ? 1 : 0;
  // 意识: 任何非清醒 → 3
  if (v.consciousness && v.consciousness !== "alert") s += 3;
  return s;
}
