import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/section-placeholder";

export const metadata: Metadata = { title: "CodeSprint" };

export default function CodeSprintPage() {
  return (
    <SectionPlaceholder
      eyebrow="CodeSprint"
      title="CodeSprint is on the way"
      body="Watch coding and prompt-engineering modules, earn points for every video and module, and collect certificates that count toward your leaderboard rank."
    />
  );
}
