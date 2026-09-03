import Link from "next/link";
import { EcosystemHub } from "@/components/ecosystem-hub";
import { FaqAccordion } from "@/components/faq-accordion";
import { HeroFlowingLight } from "@/components/hero-flowing-light";

export default function HomePage() {
  return (
    <>
      <HeroFlowingLight />
      <section className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <EcosystemHub />
      </section>
      <FaqAccordion />
    </>
  );
}
