import { useEffect, useState } from "react";
import { getIcon } from "./api";

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

export function useIcon(path: string) {
  const [icon, setIcon] = useState<string | null>(() => cache.get(path) ?? null);

  useEffect(() => {
    if (cache.has(path)) {
      setIcon(cache.get(path) ?? null);
      return;
    }
    let alive = true;
    let task = pending.get(path);
    if (!task) {
      task = getIcon(path).catch(() => null);
      pending.set(path, task);
    }
    task.then((value) => {
      cache.set(path, value);
      pending.delete(path);
      if (alive) setIcon(value);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return icon;
}
