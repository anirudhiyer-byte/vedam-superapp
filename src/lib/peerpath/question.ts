/**
 * The "What do you want to ask?" box on the booking form is required.
 * Returns the trimmed text, or null when it is empty or only whitespace.
 * No truncation here: the textarea already has maxLength 500 and the server checks its own limits.
 */
export function cleanQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim();
  return q === "" ? null : q;
}
