import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, following it as the window changes. On the server, and in a browser that cannot answer
 * media queries, it is false, so the caller shows its narrow (fallback) layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const snapshot = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
