import { useCallback, useEffect, useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEMES, applyThemeVars, getTheme, type ThemePalette } from "@/themes";

const STORAGE_KEY = "vp-theme";

let currentId = readStored();

function readStored(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && THEMES.some((t) => t.id === stored)
      ? stored
      : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const listeners = new Set<() => void>();

function setThemeId(id: string) {
  currentId = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* quota exceeded — harmless */
  }
  applyThemeVars(getTheme(id));
  listeners.forEach((fn) => { fn(); });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): string {
  return currentId;
}

/**
 * usePalette — read & switch the brand color palette.
 *
 * Palette is persisted in localStorage and applied via CSS vars on `:root`.
 * Dark mode is independent — handled by Tailwind's `.dark` class (next-themes).
 */
export function usePalette() {
  const id = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const palette = getTheme(id);

  // Apply on mount and on external changes (e.g. another tab)
  useEffect(() => {
    applyThemeVars(palette);
  }, [palette]);

  const setPalette = useCallback((nextId: string) => {
    if (THEMES.some((t) => t.id === nextId)) {
      setThemeId(nextId);
    }
  }, []);

  return { id, palette, themes: THEMES, setPalette } as const;
}

export type { ThemePalette };
