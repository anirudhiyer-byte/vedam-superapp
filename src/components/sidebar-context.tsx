"use client";
import { createContext, useContext, useEffect, useState } from "react";

const Ctx = createContext<{ collapsed: boolean; toggle: () => void }>({ collapsed: false, toggle: () => {} });

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { if (localStorage.getItem("vedam_sb_collapsed") === "1") setCollapsed(true); }, []);
  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem("vedam_sb_collapsed", n ? "1" : "0"); } catch {} return n; });
  return <Ctx.Provider value={{ collapsed, toggle }}>{children}</Ctx.Provider>;
}
export const useSidebar = () => useContext(Ctx);
