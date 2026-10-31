"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Role } from "@spm-t5/shared";
import { QUEUE_FOR_ROLE, type QueueCounts } from "@/lib/nav";
import { fetchQueueCount } from "@/lib/queueCount";

/**
 * SCRUM-178: the root layout stays mounted between pages, so the counts it read on the server go stale. This keeps them
 * current from the browser: starting from the server's, read again on each page change and whenever refreshCounts() is called.
 */
export function useQueueCounts(role: Role | undefined, serverCounts: QueueCounts | undefined, pathname: string) {
  const queue = role && QUEUE_FOR_ROLE[role];
  const [counts, setCounts] = useState<QueueCounts>(serverCounts ?? {});
  const latestRead = useRef(0);
  const previousPath = useRef(pathname);

  const refreshCounts = useCallback(async () => {
    if (!queue) return;
    const read = ++latestRead.current;
    const size = await fetchQueueCount(queue);
    // AC4: a count that could not be read keeps the last known one. An answer a newer read has overtaken is out of date.
    if (size !== undefined && read === latestRead.current) setCounts({ [queue]: size });
  }, [queue]);

  // A router.refresh() re-renders the layout, which brings newer counts from the server
  useEffect(() => setCounts(serverCounts ?? {}), [serverCounts]);

  // AC3: on a full page load the server has only just read the counts, so only a move to another page reads them again
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    void refreshCounts();
  }, [pathname, refreshCounts]);

  return { counts, refreshCounts };
}
