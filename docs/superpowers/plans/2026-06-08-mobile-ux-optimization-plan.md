# Mobile UX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise touch targets to 44px minimum, extract reusable Sheet component, add mobile keyboard hints, and optimize chat training + QA pages for mobile web use.

**Architecture:** Two-layer. Layer 1: global standards (Button sizes, Sheet component, input hints). Layer 2: per-page mobile fixes on chat training and QA. Sheets replace 3 duplicated drawer implementations.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, shadcn/ui, class-variance-authority

---

### Task 1: Raise Button Touch Targets

**Files:**
- Modify: `frontend/src/components/ui/Button.tsx:24-33`

- [ ] **Step 1: Update Button size variants**

In `Button.tsx`, change the `size` variant heights:

```tsx
      size: {
        default: "h-11 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        md: "h-11 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-11",
        "icon-xs": "size-8 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-12",
      },
```

Changes: `default/md: h-8→h-11`, `sm: h-7→h-9`, `lg: h-9→h-12`, `icon: size-8→size-11`, etc.

- [ ] **Step 2: Verify build**

```bash
cd frontend; npx tsc --noEmit --pretty 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/Button.tsx
git commit -m "♿ a11y: raise Button touch targets to 44px minimum"
```

---

### Task 2: Create Sheet Component

**Files:**
- Create: `frontend/src/components/ui/Sheet.tsx`

- [ ] **Step 1: Write `frontend/src/components/ui/Sheet.tsx`**

```tsx
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right" | "bottom";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

const WIDTH_MAP = { sm: "w-[85vw] max-w-sm", md: "w-80", lg: "w-96" };
const HEIGHT_MAP = { sm: "h-[40vh]", md: "h-[60vh]", lg: "h-[85vh]" };

const SIDE_CLASSES = {
  left: "left-0 top-0 h-full border-r translate-x-[-100%] data-[open]:translate-x-0",
  right: "right-0 top-0 h-full border-l translate-x-[100%] data-[open]:translate-x-0",
  bottom: "bottom-0 left-0 w-full border-t translate-y-[100%] data-[open]:translate-y-0 rounded-t-2xl",
};

export default function Sheet({ open, onClose, side = "right", size = "md", children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
      document.addEventListener("keydown", handler);
      return () => {
        document.body.style.overflow = "";
        document.removeEventListener("keydown", handler);
      };
    }
    document.body.style.overflow = "";
  }, [open, onClose]);

  if (!open) return null;

  const dimension = side === "bottom" ? HEIGHT_MAP[size] : WIDTH_MAP[size];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0" onClick={onClose} />
      <div
        ref={panelRef}
        data-open={open}
        className={cn(
          "fixed z-50 bg-background shadow-xl transition-transform duration-300 ease-out overscroll-contain",
          dimension,
          SIDE_CLASSES[side],
          open && "!translate-x-0 !translate-y-0",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 size-10 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={20} />
        </button>
        <div className="h-full overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd frontend; npx tsc --noEmit --pretty 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/Sheet.tsx
git commit -m "✨ feat: add Sheet component for mobile drawer panels"
```

---

### Task 3: Migrate Panels to Sheet

**Files:**
- Modify: `frontend/src/components/training/InquirySidebar.tsx`
- Modify: `frontend/src/components/training/PatientPortrait.tsx`
- Modify: `frontend/src/components/training/NursingRecordPanel.tsx`

- [ ] **Step 1: Migrate InquirySidebar**

Read `InquirySidebar.tsx`. Replace the current `fixed` overlay + panel pattern with `<Sheet>`. Keep the same props interface unchanged — only the internal rendering changes.

The component currently has its own `visible` state and render logic. Replace with:

```tsx
import Sheet from "@/components/ui/Sheet";

// Replace the fixed overlay + translate-x panel with:
<Sheet open={visible} onClose={() => setVisible(false)} side="right" size="md">
  {existing content}
</Sheet>
```

Remove the `z-40`, `bg-black/40` overlay, and `translate-x` classes — Sheet handles those.

- [ ] **Step 2: Migrate PatientPortrait**

Read `PatientPortrait.tsx`. This uses `fixed` with `left-0` when expanded, and JS `window.innerWidth <= 800` for responsive check. Replace the responsive check with `size` prop on Sheet.

```tsx
import Sheet from "@/components/ui/Sheet";
import { useMediaQuery } from "@/lib/hooks";  // or inline media query

const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
// Use Sheet only on mobile, keep desktop inline:
{isMobile ? (
  <Sheet open={isOpen} onClose={() => setIsOpen(false)} side="left" size="sm">
    {portraitContent}
  </Sheet>
) : (
  <div className={cn("h-full border-r bg-card transition-all", isOpen ? "w-72" : "w-0 overflow-hidden")}>
    {portraitContent}
  </div>
)}
```

- [ ] **Step 3: Migrate NursingRecordPanel**

Same pattern as InquirySidebar — replace `fixed` overlay + panel with `<Sheet side="right">`. The panel is activated from TrainingHeader.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/training/
git commit -m "♻️ refactor: migrate InquirySidebar/PatientPortrait/NursingRecordPanel to Sheet"
```

---

### Task 4: Add Mobile Keyboard Hints + Input Sizing

**Files:**
- Modify: `frontend/src/components/training/ChatInput.tsx`
- Modify: `frontend/src/pages/QA.tsx`

- [ ] **Step 1: Update ChatInput**

Read `ChatInput.tsx`. Find the `<input>` element. Add attributes:
```
enterkeyhint="send"
autocapitalize="off"
autocorrect="off"
inputmode="text"
```

Change input height from `h-10` to `h-11`. Change send button from `w-10 h-10` to `size-11`. Change mic button from `w-10 h-10` to `size-11`. Add `active:scale-95 transition-transform` to mic button for touch feedback.

- [ ] **Step 2: Update QA input**

In `QA.tsx`, find the `<input>` element. Add same attributes. Change padding from `py-2` to `py-3`. Change suggestion chip buttons from `py-1.5` to `py-2.5 px-3`.

- [ ] **Step 3: Add scroll-on-focus for mobile training chat**

In `ChatTraining.tsx`, add an `onFocus` handler to the input wrapper that scrolls the message area:
```tsx
const handleInputFocus = () => {
  setTimeout(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, 300);
};
```

Pass this to `ChatInput` or attach to the input ref.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/training/ChatInput.tsx frontend/src/pages/QA.tsx frontend/src/pages/ChatTraining.tsx
git commit -m "✨ feat: mobile keyboard hints, 44px input, scroll-on-focus"
```

---

### Task 5: Mobile Layout Tweaks

**Files:**
- Modify: `frontend/src/components/ChatBubble.tsx`
- Modify: `frontend/src/components/training/OperationPanel.tsx`
- Modify: `frontend/src/components/training/TrainingHeader.tsx`

- [ ] **Step 1: ChatBubble responsive max-width**

In `ChatBubble.tsx`, change bubble max-width:
```tsx
// Before: max-w-[70%]
// After: max-w-[90%] sm:max-w-[70%]
```

- [ ] **Step 2: OperationPanel mobile grid**

In `OperationPanel.tsx`, change the grid:
```tsx
// Before: grid grid-cols-3
// After: grid grid-cols-2 sm:grid-cols-3
```
Smaller text on mobile: `text-xs sm:text-sm`

- [ ] **Step 3: TrainingHeader touch targets**

In `TrainingHeader.tsx`, resize small buttons from `h-8`/`w-8` to `h-10`/`w-10` for mobile. Use `sm:h-9 sm:w-9` for desktop.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatBubble.tsx frontend/src/components/training/OperationPanel.tsx frontend/src/components/training/TrainingHeader.tsx
git commit -m "📱 ui: responsive layout tweaks for mobile chat training"
```

---

### Task 6: Verify & Lint

- [ ] **Step 1: TypeScript check**

```bash
cd frontend; npx tsc --noEmit --pretty 2>&1
```

Expected: no new errors.

- [ ] **Step 2: Run frontend tests**

```bash
cd frontend; npm test -- --run 2>&1
```

- [ ] **Step 3: Commit any fixes**

---

## Verification Checklist

1. [ ] All Button instances render with minimum 44px touch target
2. [ ] Sheet component works for left/right/bottom sides
3. [ ] InquirySidebar, PatientPortrait, NursingRecordPanel use Sheet on mobile
4. [ ] Chat input shows "send" key on mobile keyboard
5. [ ] Chat input scrolls into view on focus
6. [ ] No regressions on desktop layout
7. [ ] `npx tsc --noEmit` clean
