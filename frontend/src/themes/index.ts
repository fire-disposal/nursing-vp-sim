/** Theme palette definitions — each theme sets brand-color CSS variables.
 *
 * All themes share the same light background/foreground/border tokens.
 * Dark mode transforms these in tailwind.css's `.dark` block; themes
 * only change the accent color family.
 */
export interface ThemePalette {
  id: string;
  label: string;
  /** short description shown in switcher */
  description: string;
  colors: {
    primary: string;
    /** accent bg — light tint of primary */
    accent: string;
    chart1: string;
    chart2: string;
    chart3: string;
    chart4: string;
    chart5: string;
  };
}

const TEAL: ThemePalette = {
  id: "teal",
  label: "青碧",
  description: "清新医疗风格，默认配色",
  colors: {
    primary: "#0f766e",
    accent: "#ccfbf1",
    chart1: "#0f766e",
    chart2: "#0284c7",
    chart3: "#059669",
    chart4: "#ea580c",
    chart5: "#dc2626",
  },
};

const BLUE: ThemePalette = {
  id: "blue",
  label: "海蓝",
  description: "经典临床蓝色，沉稳可信",
  colors: {
    primary: "#2563eb",
    accent: "#dbeafe",
    chart1: "#2563eb",
    chart2: "#0891b2",
    chart3: "#16a34a",
    chart4: "#ea580c",
    chart5: "#dc2626",
  },
};

const GREEN: ThemePalette = {
  id: "green",
  label: "松绿",
  description: "自然舒缓，护眼柔和",
  colors: {
    primary: "#15803d",
    accent: "#dcfce7",
    chart1: "#15803d",
    chart2: "#0e7490",
    chart3: "#16a34a",
    chart4: "#ca8a04",
    chart5: "#dc2626",
  },
};

const SLATE: ThemePalette = {
  id: "slate",
  label: "岩灰",
  description: "严谨学术风，沉稳专业",
  colors: {
    primary: "#475569",
    accent: "#f1f5f9",
    chart1: "#475569",
    chart2: "#2563eb",
    chart3: "#059669",
    chart4: "#d97706",
    chart5: "#ef4444",
  },
};

export const THEMES: ThemePalette[] = [TEAL, BLUE, GREEN, SLATE];

export const DEFAULT_THEME = "teal";

export function getTheme(id: string): ThemePalette {
  return THEMES.find((t) => t.id === id) ?? TEAL;
}

/** Apply palette CSS variables to :root. Call from useTheme effect. */
export function applyThemeVars(palette: ThemePalette): void {
  const root = document.documentElement;
  const c = palette.colors;
  root.style.setProperty("--primary", c.primary);
  root.style.setProperty("--primary-foreground", "#ffffff");
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--accent-foreground", c.primary);
  root.style.setProperty("--ring", c.primary);
  root.style.setProperty("--chart-1", c.chart1);
  root.style.setProperty("--chart-2", c.chart2);
  root.style.setProperty("--chart-3", c.chart3);
  root.style.setProperty("--chart-4", c.chart4);
  root.style.setProperty("--chart-5", c.chart5);
  root.style.setProperty("--sidebar-primary", c.primary);
  root.style.setProperty("--sidebar-accent", c.accent);
  root.style.setProperty("--sidebar-accent-foreground", c.primary);
  root.style.setProperty("--sidebar-ring", c.primary);
}
