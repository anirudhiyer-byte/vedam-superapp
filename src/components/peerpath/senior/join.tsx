"use client";

import Link from "next/link";
import { useState } from "react";
import { ttsPath } from "@/lib/peerpath/constants";
import { IconCheck } from "@/components/peerpath/icons";
import { ProfileEditor } from "./profile-editor";

/** Sign-up for current Vedam students. Creates a senior waiting for approval and hands back their personal link. */
export function JoinAsSenior() {
  const [created, setCreated] = useState<{ id: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (created) {
    const path = ttsPath.portal(created.token);
    const full = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
    return (
      <section className="pp-card mx-auto flex max-w-[640px] flex-col items-center gap-4 p-6 text-center sm:p-8">
        <div aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-[#0f2e1c] text-[#4ADE80]">
          <IconCheck className="h-7 w-7" />
        </div>
        <h1 className="text-[24px] font-bold text-pp-heading">You&apos;re in. One last step.</h1>
        <p className="text-[15px] leading-relaxed text-pp-muted">
          This is your personal senior link. Save it now: it is the only way back to your page. Add your free times there. The Vedam team will approve your profile, and then applicants can book you.
        </p>
        <code className="w-full break-all rounded-xl border border-pp-line bg-[#0c0718] px-4 py-3 text-left text-[13px] text-pp-ink">{full}</code>
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="pp-btn-secondary flex-1"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(full);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy my link"}
          </button>
          <Link href={path} className="pp-btn-primary flex-1">
            Open my page and add times
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold text-pp-heading">Become a senior</h1>
        <p className="max-w-[60ch] text-[16px] text-pp-muted">
          For current Vedam students. Help applicants by sharing your own experience in short video chats, at times you choose. Only your first name and home city are shown.
        </p>
      </div>
      <ProfileEditor
        initial={{
          firstName: "",
          campus: "Pune",
          year: 1,
          homeCity: null,
          homeState: null,
          residence: null,
          languages: ["English"],
          topics: [],
          askMeAbout: [],
          clubs: [],
          bio: "",
          sessionTypes: ["1:1"],
          durations: [30],
          meetLink: null,
          contactEmail: "",
        }}
        onCreated={setCreated}
      />
      <p className="text-[14px] text-pp-muted">
        By joining you agree to the{" "}
        <Link href={ttsPath.guidelines} className="font-semibold text-pp-violet-600 underline underline-offset-2">
          session guidelines
        </Link>
        .
      </p>
    </div>
  );
}
