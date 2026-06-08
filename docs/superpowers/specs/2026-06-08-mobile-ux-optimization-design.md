# Mobile UX Optimization Design

**Date**: 2026-06-08  
**Status**: Design  
**Author**: Tech Lead

---

## Goal

Improve mobile web experience for the nursing VP simulator without layout overhauls. Two-layer approach: global standards infrastructure (buttons, sheets, input hints) + core interaction path (chat training, QA).

**Excluded:** Admin/teacher management pages (desktop-first, separate effort).

---

## Part A: Global Standards Infrastructure

### A1. Touch Target Standard

All interactive elements must meet 44px minimum (WCAG 2.5.5).

**Implementation:** Update `Button` component height classes:

| Size | Before | After |
|------|--------|-------|
| `icon-xs` | 24px | 32px |
| `sm` / `icon-sm` | 28px | 36px |
| `default` / `icon` | 32px | 44px |
| `lg` / `icon-lg` | 36px | 48px |

Tweak related spacing/padding to maintain visual balance. All pages using `<Button>` inherit this automatically.

**Files:** `src/components/ui/Button.tsx`

### A2. Sheet Component

Extract duplicated drawer pattern (fixed overlay + slide panel) into reusable component.

**API:**
```tsx
interface SheetProps {
  open: boolean;
  onClose: () => void;
  side: "left" | "right" | "bottom";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}
```

**Behavior:**
- Overlay backdrop with `bg-black/40`
- Slide animation via CSS `translate-x` (left/right) or `translate-y` (bottom)
- `overscroll-behavior: contain` to prevent background scroll
- Close on backdrop click / Escape key
- Portal to body for correct z-index

**Migrate existing panels to Sheet:** `InquirySidebar`, `PatientPortrait`, `NursingRecordPanel` use Sheet internally without changing their own props API.

**Files:** New `src/components/ui/Sheet.tsx`; modify `InquirySidebar.tsx`, `PatientPortrait.tsx`, `NursingRecordPanel.tsx`

### A3. Input Enhancements

Add mobile keyboard hints to chat inputs:

```html
<input
  enterkeyhint="send"
  autocapitalize="off"
  autocorrect="off"
  inputmode="text"
/>
```

**Files:** `ChatInput.tsx`, `QA.tsx`

---

## Part B: Core Interaction Path

### B1. ChatInput Responsive

- Height: `h-10` (40px) → `h-11` (44px). Send/mic buttons match.
- Add `onFocus` handler in `ChatTraining.tsx`: scroll input into view with `behavior: "smooth"` after 300ms delay (keyboard open animation)
- Mic button: `active:scale-95` haptic feedback on mobile

**Files:** `ChatInput.tsx`, `ChatTraining.tsx`

### B2. Training Page Space Optimization

**Panel widths on mobile:**
- `InquirySidebar`, `PatientPortrait`, `NursingRecordPanel`: desktop keeps current width, mobile uses `w-[85vw]` or `w-full`
- Via Sheet component's `size` prop

**ChatBubble max-width:**
- Desktop: `max-w-[70%]`
- Mobile: `max-w-[90%]`

**OperationPanel grid:**
- Desktop: `grid-cols-3`
- Mobile: `grid-cols-2`, smaller text

**PatientPortrait responsive refactor:**
- Replace hardcoded `window.innerWidth <= 800` check with Tailwind `md:` breakpoint (768px) — aligns with rest of the UI
- The portrait toggle icon from `w-[30px] h-[30px]` to `w-10 h-10` (40px)

**Files:** `ChatBubble.tsx`, `OperationPanel.tsx`, `PatientPortrait.tsx`, `InquirySidebar.tsx`, `TrainingHeader.tsx`

### B3. QA Page Micro-fixes

- Input `h-10` → `h-11` (44px)
- Add `enterkeyhint="send"`
- Sidebar on ≤375px: `w-[85vw]` instead of fixed 288px
- Suggestion chip buttons: increase `py-1.5` → `py-2.5` for touch spacing

**Files:** `QA.tsx`

---

## Success Criteria

1. All Button instances pass 44px touch target (via component class update)
2. Sheet component replaces 3 duplicated drawer implementations
3. Chat input on mobile: 44px height, "send" key on keyboard, scrolls into view on focus
4. Training page panels use responsive widths via Sheet
5. No regressions on desktop layout
6. Existing visual tests / lint pass
