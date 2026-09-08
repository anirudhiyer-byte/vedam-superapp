/** Exact option values from the original College Predictor (must match the DB). */
export const CP_STATES: { id: number; name: string }[] = [
  { id: 64, name: "Andhra Pradesh" }, { id: 65, name: "Arunachal Pradesh" }, { id: 66, name: "Assam" },
  { id: 67, name: "Bihar" }, { id: 69, name: "Chhattisgarh" }, { id: 72, name: "Delhi" }, { id: 73, name: "Goa" },
  { id: 74, name: "Gujarat" }, { id: 75, name: "Haryana" }, { id: 76, name: "Himachal Pradesh" },
  { id: 77, name: "Jammu and Kashmir" }, { id: 78, name: "Jharkhand" }, { id: 79, name: "Karnataka" },
  { id: 80, name: "Kerala" }, { id: 82, name: "Madhya Pradesh" }, { id: 83, name: "Maharashtra" },
  { id: 84, name: "Manipur" }, { id: 85, name: "Meghalaya" }, { id: 86, name: "Mizoram" }, { id: 87, name: "Nagaland" },
  { id: 88, name: "Odisha" }, { id: 89, name: "Puducherry" }, { id: 90, name: "Punjab" }, { id: 91, name: "Rajasthan" },
  { id: 92, name: "Sikkim" }, { id: 93, name: "Tamil Nadu" }, { id: 94, name: "Tripura" }, { id: 95, name: "Uttar Pradesh" },
  { id: 96, name: "Uttarakhand" }, { id: 97, name: "West Bengal" }, { id: 98, name: "Telangana" },
];
export const CP_CATEGORIES = ["OPEN", "OPEN (PwD)", "EWS", "OBC-NCL", "SC", "ST", "OBC-NCL (PwD)", "SC (PwD)", "EWS (PwD)", "ST (PwD)"];
export const CP_GENDERS = [{ value: "Gender Neutral", label: "Gender Neutral" }, { value: "Female", label: "Female Only" }];
export const CP_STREAMS = ["PCM", "PCM with Biology"];
export const CP_YEARS = ["2026", "2025", "2024 or Before"];

/** Map a stored profile state NAME -> the predictor's state_id (best-effort). */
export function stateNameToId(name?: string | null): number | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const hit = CP_STATES.find((s) => s.name.toLowerCase() === n);
  return hit ? hit.id : null;
}
