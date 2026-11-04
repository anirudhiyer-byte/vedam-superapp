/** Upload Raw Data — static config for the 4-step wizard. */

export const STEPS = ["List setup", "Checklist", "Upload CSV", "Map columns"] as const;
export type StepIndex = 0 | 1 | 2 | 3;

export const MAX_ROWS = 500_000;
export const MAX_ROWS_LABEL = "5,00,000";

/** The four things that break most imports. All four must be confirmed. */
export const CHECKLIST = [
  { id: "csv", title: "My file is saved as .csv", body: "Using Excel? Choose Save As and pick CSV. .xlsx and .numbers files will not be accepted." },
  { id: "headers", title: "Row 1 holds the column names", body: "Each column needs a header so it can be matched to a contact field in the last step." },
  { id: "contact", title: "Every row has an email or a mobile number", body: "Rows with neither are skipped. Use the country code, or plain 10-digit Indian numbers." },
  { id: "dupes", title: "I know duplicates are skipped", body: "If an email or mobile already exists in this list, that row is not imported again." },
] as const;

export const SAMPLE_CSV = {
  filename: "vedam-sample-contacts.csv",
  headers: ["Full name", "Email", "Mobile number", "City", "Course interested", "Source"],
  rows: [
    ["Test Student 09", "test.student09@example.com", "9000000012", "Pune", "CS & AI", "Expo"],
    ["Test Student 10", "test.student10@example.com", "9000000013", "Gurugram", "CS & AI", "Walk-in"],
  ],
};

export type FormValues = { institute: string; form: string; name: string; description: string };
export const EMPTY_FORM: FormValues = { institute: "vedam", form: "", name: "", description: "" };

/** Best-guess mapping from CSV header text to a contact field. */
export function guessMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h) => {
    const k = h.toLowerCase();
    out[h] =
      /mail/.test(k) ? "email"
      : /mobile|phone|contact|whats/.test(k) ? "mobile"
      : /name/.test(k) ? "name"
      : /city|location/.test(k) ? "city"
      : /course|program|branch/.test(k) ? "course"
      : /utm|campaign/.test(k) ? "utm_campaign"
      : /source|channel/.test(k) ? "source"
      : /remark|note|comment/.test(k) ? "remarks"
      : "";
  });
  return out;
}

export const fmt = (n: number) => n.toLocaleString("en-IN");
