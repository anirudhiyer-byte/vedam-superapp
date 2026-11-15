/** Choices used by the Create Automation wizard (dummy lists; swap for the real option endpoints). */
export const CATEGORIES = [
  { value: "Lead/Application", label: "Lead/Application", hint: "Runs for leads and application forms" },
  { value: "Opportunity", label: "Opportunity", hint: "Runs for opportunities" },
  { value: "Activity", label: "Activity", hint: "Runs when an activity is logged" },
  { value: "ToDo", label: "ToDo", hint: "Not available yet", disabled: true },
];

export const TRIGGERS = [
  { value: "On Creation", label: "On Creation", hint: "When a new record is created" },
  { value: "On Field Update", label: "On Field Update", hint: "When a field changes" },
  { value: "On Specific Date", label: "On Specific Date", hint: "On the date in a date field" },
  { value: "At Regular Intervals", label: "At Regular Intervals", hint: "Again and again on a schedule" },
];

/** Triggers that need one extra choice, and what to call it. */
export const TRIGGER_CONFIG: Record<string, { label: string; placeholder: string; options: string[] } | undefined> = {
  "On Field Update": { label: "Update field", placeholder: "Select field", options: ["Lead Stage", "Lead Status", "Payment Status", "Owner"] },
  "On Specific Date": { label: "Date field", placeholder: "Select date field", options: ["Application Date", "VSAT Slot Date", "Created On"] },
  "At Regular Intervals": { label: "Repeat automation", placeholder: "Select repeat", options: ["Every day", "Every week", "Every month"] },
};

/** Date and interval triggers do not use entry conditions, so the wizard skips that step for them. */
export const SKIPS_CONDITIONS = (trigger: string) => trigger === "On Specific Date" || trigger === "At Regular Intervals";

export const MODULES: Record<string, string[]> = {
  "Lead/Application": ["Lead", "Application Form"],
  Opportunity: ["Opportunity"],
  Activity: ["Lead", "Application Form"],
};

export const CONDITION_FIELDS = ["Lead Stage", "Lead Status", "Payment Status", "Source", "City"];
export const CONDITION_OPS = ["is", "is not", "contains"];
