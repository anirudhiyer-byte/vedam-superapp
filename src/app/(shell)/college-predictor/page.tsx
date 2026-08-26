import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/section-placeholder";

export const metadata: Metadata = { title: "College Predictor" };

export default function CollegePredictorPage() {
  return (
    <SectionPlaceholder
      eyebrow="College Predictor"
      title="College Predictor is on the way"
      body="Enter your JEE score and see the colleges within your reach. Running it once adds to your points, too."
    />
  );
}
