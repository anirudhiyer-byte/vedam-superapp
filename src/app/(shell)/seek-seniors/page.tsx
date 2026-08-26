import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/section-placeholder";

export const metadata: Metadata = { title: "Seek Your Seniors" };

export default function SeekSeniorsPage() {
  return (
    <SectionPlaceholder
      eyebrow="Seek Your Seniors"
      title="Seek Your Seniors is on the way"
      body="Ask questions, clear doubts, and get mentorship from current Vedam students — real guidance from people who were recently in your seat."
    />
  );
}
