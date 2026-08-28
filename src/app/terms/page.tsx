import type { Metadata } from "next";
import { LegalLayout, Section } from "@/components/legal-layout";

export const metadata: Metadata = { title: "Terms of Service" };
const UPDATED = "28 August 2026";
const CONTACT = "connect@vedam.org";

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated={UPDATED}>
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of the platform operated by
        <b> SET Education Technology Private Limited</b>, doing business as <b>Vedam School of Technology</b>
        (&quot;Vedam&quot;, &quot;we&quot;, &quot;us&quot;). By creating an account or using the Platform, you agree to these Terms.
      </p>

      <Section heading="1. Eligibility">
        <p>
          The Platform is intended for students and prospective students. If you are under 18, you may use the
          Platform only with the involvement, consent, and supervision of a parent or legal guardian, who agrees
          to be bound by these Terms on your behalf.
        </p>
      </Section>

      <Section heading="2. Your account">
        <p>
          You agree to provide accurate information and to keep it up to date. Access is verified using one-time
          passwords sent to your phone or email. You are responsible for activity on your account and for keeping
          access to your phone and email secure. Notify us promptly of any unauthorised use.
        </p>
      </Section>

      <Section heading="3. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Create accounts using false information or someone else&apos;s identity.</li>
          <li>Attempt to disrupt, overload, or gain unauthorised access to the Platform.</li>
          <li>Use automated means to register, scrape, or interfere with the service.</li>
          <li>Misuse events, points, or certificates, or attempt to manipulate them.</li>
        </ul>
      </Section>

      <Section heading="4. Events, points, and certificates">
        <p>
          Events are offered subject to availability and any stated eligibility or capacity limits. Points and
          certificates are recognitions issued at our discretion, have <b>no monetary value</b>, are
          non-transferable, and cannot be exchanged for cash. We may adjust, correct, or revoke points or
          certificates where we reasonably believe they were awarded in error or through misuse.
        </p>
      </Section>

      <Section heading="5. Communications">
        <p>
          By registering, you agree to receive transactional messages (such as OTPs, confirmations, and event
          details) by SMS and email. These are necessary to provide the service.
        </p>
      </Section>

      <Section heading="6. Intellectual property">
        <p>
          The Platform, its content, branding, and materials are owned by or licensed to Vedam and are protected
          by applicable laws. You may not copy, distribute, or create derivative works without our permission,
          except for content you are expressly permitted to share (such as your own certificate).
        </p>
      </Section>

      <Section heading="7. Third-party services">
        <p>
          The Platform relies on third-party services (for hosting, messaging, analytics, and video
          conferencing). Your use of those features may also be subject to the respective providers&apos; terms.
        </p>
      </Section>

      <Section heading="8. Disclaimers and limitation of liability">
        <p>
          The Platform is provided on an &quot;as is&quot; and &quot;as available&quot; basis without warranties of any kind. To
          the maximum extent permitted by law, Vedam shall not be liable for any indirect, incidental, or
          consequential damages arising from your use of the Platform.
        </p>
      </Section>

      <Section heading="9. Suspension and termination">
        <p>
          We may suspend or terminate access if you breach these Terms or misuse the Platform. You may stop using
          the Platform and request deletion of your account at any time.
        </p>
      </Section>

      <Section heading="10. Governing law">
        <p>
          These Terms are governed by the laws of India, and the courts at our registered place of business shall
          have jurisdiction, subject to applicable law.
        </p>
      </Section>

      <Section heading="11. Contact">
        <p>
          Questions about these Terms? Contact us at <a className="text-accent" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>

      <Section heading="12. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Continued use of the Platform after changes take effect
          constitutes acceptance of the revised Terms.
        </p>
      </Section>
    </LegalLayout>
  );
}
