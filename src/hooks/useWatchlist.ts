"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";

interface WatchlistData {
  version: 1;
  marketIds: string[];
  addedAt: Record<string, number>;
}

const DEFAULT: WatchlistData = {
  version: 1,
  marketIds: [],
  addedAt: {},
};

export function useWatchlist() {
  const [data, setData] = useLocalStorage<WatchlistData>("pw:watchlist", DEFAULT);

  const watchedIds = useMemo(() => new Set(data.marketIds), [data.marketIds]);

  const isWatched = useCallback(
    (id: string) => watchedIds.has(id),
    [watchedIds]
  );

  const toggleWatch = useCallback(
    (id: string) => {
      setData((prev) => {
        if (prev.marketIds.includes(id)) {
          const newIds = prev.marketIds.filter((mid) => mid !== id);
          const newAddedAt = { ...prev.addedAt };
          delete newAddedAt[id];
          return { ...prev, marketIds: newIds, addedAt: newAddedAt };
        } else {
          return {
            ...prev,
            marketIds: [...prev.marketIds, id],
            addedAt: { ...prev.addedAt, [id]: Date.now() },
          };
        }
      });
    },
    [setData]
  );

  const removeWatch = useCallback(
    (id: string) => {
      setData((prev) => {
        const newIds = prev.marketIds.filter((mid) => mid !== id);
        const newAddedAt = { ...prev.addedAt };
        delete newAddedAt[id];
        return { ...prev, marketIds: newIds, addedAt: newAddedAt };
      });
    },
    [setData]
  );

  return {
    watchedIds,
    isWatched,
    toggleWatch,
    removeWatch,
    count: data.marketIds.length,
    addedAt: data.addedAt,
  };
}
