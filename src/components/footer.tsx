import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-6 font-body text-sm text-muted sm:px-10">
        <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
        <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
        <a href="mailto:connect@vedam.org" className="hover:text-foreground">Contact</a>
        <span className="ml-auto text-xs">© {new Date().getFullYear()} SET Education Technology Pvt. Ltd.</span>
      </div>
    </footer>
  );
}
