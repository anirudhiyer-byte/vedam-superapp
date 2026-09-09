"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";

const SOCIALS: [string, string, string][] = [
  ["YouTube", "https://www.youtube.com/@vedamschooloftechnology", "M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.5 31 31 0 0 0-.5-4.5zM9.8 15.3V8.7l5.7 3.3z"],
  ["Instagram", "https://www.instagram.com/vedamschooloftechnology/", "M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.6 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 4 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2m0 3.3A6.5 6.5 0 1 0 18.5 12 6.5 6.5 0 0 0 12 5.5m0 10.7A4.2 4.2 0 1 1 16.2 12 4.2 4.2 0 0 1 12 16.2m6.8-11a1.5 1.5 0 1 0 1.5 1.5 1.5 1.5 0 0 0-1.5-1.5"],
  ["LinkedIn", "https://www.linkedin.com/school/vedam-school-of-technology/", "M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6V21h-4v-5.3c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21H9z"],
  ["Telegram", "https://t.me/vedamschooloftechnology", "M21.9 4.3 2.8 11.6c-1 .4-1 1.4-.1 1.7l4.9 1.5 1.9 5.9c.2.6.5.7 1 .3l2.7-2.2 4.7 3.5c.6.4 1.2.2 1.4-.6l3.3-15.6c.2-1-.4-1.5-1.6-1z"],
];

export function Footer() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <footer className="flex flex-row flex-wrap gap-8 border-t border-white/10 px-6 py-12 font-[family-name:var(--font-inter)] text-white sm:gap-32 sm:px-16 sm:py-14" style={{ background: "#000000" }}>
      <div>
        <h4 className="mb-2.5 text-base font-semibold sm:text-xl">Quick Links</h4>
        <Link href="/privacy" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">Privacy Policy</Link>
        <Link href="/terms" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">Terms of Service</Link>
      </div>
      <div>
        <h4 className="mb-2.5 text-base font-semibold sm:text-xl">Contact Us</h4>
        <a href="mailto:connect@vedam.org" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">connect@vedam.org</a>
        <a href="tel:+919201010176" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">+91 92010 10176</a>
      </div>
      <div>
        <h4 className="mb-2.5 text-base font-semibold sm:text-xl">Follow Us</h4>
        <div className="mt-2 flex gap-3.5">
          {SOCIALS.map(([t, href, d]) => (
            <a key={t} title={t} href={href} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-[9px] bg-[#1e1e1e] transition-colors hover:bg-[#8A18FF]">
              <svg viewBox="0 0 24 24" fill="#fff" width="17" height="17"><path d={d} /></svg>
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
