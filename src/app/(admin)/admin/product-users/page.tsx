import type { Metadata } from "next";
import { ProductUsers } from "@/components/admin/product-users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Product Users", robots: { index: false, follow: false } };

export default function Page() {
  return <ProductUsers />;
}
