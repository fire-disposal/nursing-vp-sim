export interface MewsInput {
  hr?: number;
  sbp?: number;
  rr?: number;
  temp?: number;
  consciousness?: "alert" | "confused" | "lethargic" | "unresponsive";
}

export function calcMews(v: MewsInput): number {
  let s = 0;
  if (v.hr != null) s += v.hr <= 40 || v.hr >= 131 ? 3 : v.hr <= 50 || v.hr >= 111 ? 2 : v.hr >= 101 ? 1 : 0;
  if (v.sbp != null) s += v.sbp <= 70 || v.sbp >= 201 ? 3 : v.sbp <= 80 || v.sbp >= 191 ? 2 : v.sbp <= 100 || v.sbp >= 111 ? 1 : 0;
  if (v.rr != null) s += v.rr <= 8 || v.rr >= 26 ? 3 : v.rr <= 11 || v.rr >= 21 ? 2 : v.rr >= 16 ? 1 : 0;
  if (v.temp != null) s += v.temp <= 35 || v.temp >= 39 ? 2 : v.temp <= 36 || v.temp >= 38.5 ? 1 : 0;
  if (v.consciousness === "unresponsive") s += 3;
  else if (v.consciousness === "lethargic" || v.consciousness === "confused") s += 1;
  return s;
}
