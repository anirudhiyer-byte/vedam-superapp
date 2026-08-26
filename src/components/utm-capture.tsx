"use client";

import { useEffect } from "react";
import { captureUtm } from "@/lib/utm";

/** Mount once near the root — records first-touch UTM on landing. */
export function UtmCapture() {
  useEffect(() => {
    captureUtm();
  }, []);
  return null;
}
