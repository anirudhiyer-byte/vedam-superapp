import type { Metadata } from "next";
import { ProfilePage } from "@/components/profile/profile-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Profile" };
export default function Page() { return <ProfilePage />; }
