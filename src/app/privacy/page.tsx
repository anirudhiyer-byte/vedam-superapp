import type { Metadata } from "next";
import { LegalLayout, Section } from "@/components/legal-layout";

export const metadata: Metadata = { title: "Privacy Policy" };
const UPDATED = "28 August 2026";
const CONTACT = "connect@vedam.org";

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated={UPDATED}>
      <p>
        This Privacy Policy explains how <b>SET Education Technology Private Limited</b>, operating as
        <b> Vedam School of Technology</b> (&quot;Vedam&quot;, &quot;we&quot;, &quot;us&quot;), collects, uses, and protects your
        personal data when you use the Vedam platform (the &quot;Platform&quot;). We are committed to handling
        your data in accordance with India&apos;s Digital Personal Data Protection Act, 2023 (&quot;DPDP Act&quot;).
      </p>

      <Section heading="1. Information we collect">
        <p>When you create an account and use the Platform, we collect:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Account details</b> — your name, phone number, email address, Class 12 graduation year, and stream.</li>
          <li><b>Verification data</b> — one-time passwords (OTPs) sent to your phone/email to confirm your identity.</li>
          <li><b>Activity data</b> — events you register for and attend, points earned, and certificates issued.</li>
          <li><b>Attendance data</b> — for online sessions, whether you joined and how long you stayed.</li>
          <li><b>Technical &amp; usage data</b> — pages visited, device/browser information, and the marketing source (UTM parameters) that referred you, collected via analytics tools.</li>
        </ul>
      </Section>

      <Section heading="2. How we use your information">
        <ul className="list-disc space-y-1 pl-5">
          <li>To create and secure your account and verify your identity.</li>
          <li>To operate events — registration, reminders, calendar invites, certificates, and attendance.</li>
          <li>To award and display points across the Vedam ecosystem.</li>
          <li>To communicate with you about your account, events, and services you&apos;ve engaged with.</li>
          <li>To understand how the Platform is used and to improve it.</li>
          <li>To comply with legal obligations and prevent fraud or misuse.</li>
        </ul>
      </Section>

      <Section heading="3. Consent">
        <p>
          We process your personal data based on the consent you provide when you register. You may withdraw
          your consent at any time by contacting us (see Section 10); withdrawing consent may limit your ability
          to use parts of the Platform.
        </p>
      </Section>

      <Section heading="4. Children and minors">
        <p>
          The Platform is intended for students, many of whom may be under 18. In line with the DPDP Act, if you
          are a minor, you should use the Platform only with the consent and supervision of a parent or legal
          guardian, and by registering you confirm that such consent has been obtained. We do not knowingly
          use children&apos;s personal data in a way that is likely to cause harm, and we do not carry out
          tracking, behavioural monitoring, or targeted advertising directed at children. A parent or guardian
          may contact us to review or delete a minor&apos;s data.
        </p>
      </Section>

      <Section heading="5. How we share your information">
        <p>We do not sell your personal data. We share it only with trusted service providers who help us run the Platform, under appropriate safeguards:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Hosting &amp; database</b> — for storing your account and activity data securely.</li>
          <li><b>SMS &amp; email providers</b> — to deliver OTPs, confirmations, and event communications.</li>
          <li><b>Analytics providers</b> — to measure and improve Platform usage.</li>
          <li><b>Video conferencing</b> — for online events and attendance.</li>
        </ul>
        <p>We may also disclose data where required by law or to protect our legal rights.</p>
      </Section>

      <Section heading="6. Cookies and analytics">
        <p>
          We use analytics tools that may set cookies or similar identifiers to understand aggregate usage and
          traffic sources. You can control cookies through your browser settings.
        </p>
      </Section>

      <Section heading="7. Data retention">
        <p>
          We retain your personal data for as long as your account is active or as needed to provide the
          Platform, and thereafter only as long as required to meet legal, accounting, or reporting obligations.
        </p>
      </Section>

      <Section heading="8. Security">
        <p>
          We use reasonable technical and organisational measures — including access controls, encryption in
          transit, and row-level data isolation — to protect your data. No method of transmission or storage is
          completely secure, but we work to protect your information and review our practices regularly.
        </p>
      </Section>

      <Section heading="9. Your rights">
        <p>Subject to the DPDP Act, you have the right to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Access the personal data we hold about you and a summary of its processing.</li>
          <li>Request correction or updating of inaccurate or incomplete data.</li>
          <li>Request erasure of your data, subject to legal retention requirements.</li>
          <li>Withdraw consent, and nominate another person to exercise your rights in the event of death or incapacity.</li>
          <li>Raise a grievance with us (see below).</li>
        </ul>
      </Section>

      <Section heading="10. Grievances and contact">
        <p>
          For any questions, requests, or grievances regarding your personal data, contact our Grievance Officer
          at <a className="text-accent" href={`mailto:${CONTACT}`}>{CONTACT}</a>. We will acknowledge and address
          your request within the timelines prescribed under applicable law.
        </p>
      </Section>

      <Section heading="11. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. Material changes will be notified through the
          Platform. Your continued use after an update constitutes acceptance of the revised policy.
        </p>
      </Section>
    </LegalLayout>
  );
}
