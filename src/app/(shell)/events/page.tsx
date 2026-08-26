import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/section-placeholder";

export const metadata: Metadata = { title: "Events" };

export default function EventsPage() {
  return (
    <SectionPlaceholder
      eyebrow="Events"
      title="Events land here"
      body="The Vedam events experience — hosting, custom forms, analytics, emailer, dashboards — gets ported into this space and tied to your logged-in account, so every registration becomes part of your Vedam profile."
    />
  );
}
