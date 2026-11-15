import { redirect } from "next/navigation";
import { isAdminUser } from "./server";

/**
 * Pre-launch switch. While false, applicant pages are admin-only (non-admins go to vedam.org, same as the
 * College Predictor) and the nav shows PeerPath as "Soon" to everyone else.
 * Senior pages (personal link, become-a-senior) stay open so seniors can set up.
 * Flip to true at launch, and drop `soon: true` from the PeerPath nav item.
 */
export const PEERPATH_LIVE = false;

export async function guardPeerPath() {
  if (PEERPATH_LIVE) return;
  if (!(await isAdminUser())) redirect("https://www.vedam.org");
}
