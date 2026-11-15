import "./peerpath.css";

// every PeerPath page renders next to the Supabase database (ap-south-1, Mumbai); child pages inherit this
export const preferredRegion = "bom1";

export default function PeerPathLayout({ children }: { children: React.ReactNode }) {
  return <div className="pp min-h-[70vh] bg-pp-page">{children}</div>;
}
