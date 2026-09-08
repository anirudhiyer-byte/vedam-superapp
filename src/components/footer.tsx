"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";

const socials = [
  {
    name: "YouTube", href: "https://www.youtube.com/@vedamschooloftechnology",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z" /></svg>
    ),
  },
  {
    name: "Instagram", href: "https://www.instagram.com/vedamschooloftechnology/",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" /></svg>
    ),
  },
  {
    name: "LinkedIn", href: "https://www.linkedin.com/school/vedam-school-of-technology/",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M20.45 20.45h-3.56v-5.57c0-1.33 0-3.04-1.85-3.04s-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05a3.75 3.75 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0Z" /></svg>
    ),
  },
  {
    name: "Telegram", href: "https://t.me/vedamschooloftechnology",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M21.94 4.3 18.9 19.02c-.23 1.01-.83 1.26-1.68.78l-4.64-3.42-2.24 2.16c-.25.25-.46.46-.94.46l.33-4.73L18.68 5.5c.37-.33-.08-.51-.58-.18L6.44 12.9l-4.6-1.44c-1-.31-1.02-1 .21-1.48L20.65 2.6c.83-.31 1.56.2 1.29 1.7Z" /></svg>
    ),
  },
];

export function Footer() {
  const _pathname = usePathname();
  if (_pathname === "/") return null;
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <div className="grid gap-8 sm:grid-cols-3">
          {/* Quick links */}
          <div>
            <h3 className="font-display text-sm font-bold text-heading">Quick Links</h3>
            <ul className="mt-3 space-y-2 font-body text-sm text-muted">
              <li><Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-foreground">Terms of Service</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-display text-sm font-bold text-heading">Contact Us</h3>
            <ul className="mt-3 space-y-2 font-body text-sm text-muted">
              <li><a href="mailto:connect@vedam.org" className="hover:text-foreground">connect@vedam.org</a></li>
              <li><a href="tel:+919201010176" className="hover:text-foreground">+91 92010 10176</a></li>
            </ul>
          </div>

          {/* Follow us */}
          <div>
            <h3 className="font-display text-sm font-bold text-heading">Follow Us</h3>
            <ul className="mt-3 space-y-2.5 font-body text-sm text-muted">
              {socials.map((s) => (
                <li key={s.name}>
                  <a href={s.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2.5 hover:text-foreground">
                    <span className="text-muted">{s.icon}</span>{s.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-5 font-body text-xs text-muted">
          © {new Date().getFullYear()} SET Education Technology Pvt. Ltd.
        </div>
      </div>
    </footer>
  );
}
