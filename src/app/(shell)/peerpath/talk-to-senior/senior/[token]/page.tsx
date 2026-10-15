import type { Metadata } from "next";
import Link from "next/link";
import { TtsNav } from "@/components/peerpath/tts-nav";
import { SeniorPortal } from "@/components/peerpath/senior/senior-portal";
import { EmptyState } from "@/components/peerpath/ui";
import { ttsPath } from "@/lib/peerpath/constants";
import { loadPortal } from "@/lib/peerpath/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Senior page — Talk to a Senior · Vedam", robots: { index: false, follow: false } };

/** A senior's own page. The token in the link is their key, so no login is needed. */
export default async function SeniorPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const portal = await loadPortal(token);

  return (
    <>
      <TtsNav label="Senior page" />
      <div className="mx-auto max-w-[1040px] px-4 py-6 sm:px-6 lg:py-10">
        {portal ? (
          <SeniorPortal token={token} portal={portal} />
        ) : (
          <EmptyState title="This link isn't active" body="Please use the personal link you got when you joined, or ask the Vedam team for a new one.">
            <Link href={ttsPath.join} className="pp-btn-secondary mt-2">
              New here? Become a senior
            </Link>
          </EmptyState>
        )}
      </div>
    </>
  );
}
