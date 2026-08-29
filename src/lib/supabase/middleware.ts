import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Routes that require a logged-in user. Prefix match. Add account/dashboard
 * paths here as they get built. `/admin` is handled separately (needs the
 * admin role, not just any session).
 */
const AUTH_REQUIRED = ["/account", "/dashboard"];

/** Auth pages a logged-in user shouldn't sit on — bounce them home. */
const AUTH_PAGES = ["/login", "/register"];

function redirectWithCookies(url: URL, from: NextResponse) {
  const res = NextResponse.redirect(url);
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

/**
 * Refreshes the Supabase session on every request AND enforces route access:
 *  - /admin        -> must be logged in AND have the admin role
 *  - AUTH_REQUIRED -> must be logged in
 *  - logged-out hits on gated routes bounce to /login?next=<path> (deeplink return)
 *  - logged-in hits on /login|/register bounce home
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAdminPath = path === "/admin" || path.startsWith("/admin/");
  const needsAuth = AUTH_REQUIRED.some((p) => path === p || path.startsWith(p + "/"));
  const isAuthPage = AUTH_PAGES.some((p) => path === p || path.startsWith(p + "/"));

  // logged-out on a gated route -> login, remember where they were going
  if (!user && (isAdminPath || needsAuth)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    return redirectWithCookies(url, supabaseResponse);
  }

  // admin route -> must actually be an admin.
  // Fast path: verified @vedam.org staff are admins by domain (matches is_admin()),
  // so we skip the network RPC — this also avoids a cold-load race that could
  // transiently return false and bounce a real admin home.
  if (user && isAdminPath) {
    const email = (user.email ?? "").toLowerCase();
    const isStaffDomain = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    let isAdmin = isStaffDomain;
    if (!isAdmin) {
      const { data } = await supabase.rpc("is_admin");
      isAdmin = !!data;
    }
    if (!isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return redirectWithCookies(url, supabaseResponse);
    }
  }

  // already logged in -> no need to sit on login/register
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectWithCookies(url, supabaseResponse);
  }

  return supabaseResponse;
}
