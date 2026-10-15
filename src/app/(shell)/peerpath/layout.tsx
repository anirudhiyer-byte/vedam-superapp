import "./peerpath.css";

export default function PeerPathLayout({ children }: { children: React.ReactNode }) {
  return <div className="pp min-h-[70vh] bg-pp-page">{children}</div>;
}
