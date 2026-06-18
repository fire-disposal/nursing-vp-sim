# UX Interaction Tree Analysis
Date: 2026-06-18

## User Flow
```
Login → CaseSelect → Training/:id → [WelcomeScreen | ChatArea] → ... → RecordDetail
```

## Component Tree in Training
```
TrainingEngine
├── PatientProvider (data)
├── EmotionProvider (context)
├── PortraitProvider (context)
├── TrainingHeader
├── ChatArea
│   ├── EmotionIndicator (conditional on features.emotion)
│   ├── [WelcomeScreen | ChatDisplay] (conditional on messages.length)
│   ├── InitiativeBar (conditional on features.patient_initiative)
│   └── ChatInput
└── PanelHost (collapsible)
    └── [panel plugins...] (each wrapped in PluginErrorBoundary)
├── ScoringOverlay (conditional on training:ended event)
└── ScoreCard (conditional)
```

## Issues Found

| # | Severity | Component | Issue | Fix |
|---|----------|-----------|-------|-----|
| 1 | HIGH | ChatArea — WelcomeScreen vs ChatDisplay | Instant switch, no fade/slide transition between states; content height may differ causing abrupt layout change | Add `animate-fadeIn` or CSS transition on mount; wrap transition group around conditional render |
| 2 | HIGH | EmotionIndicator | Returns `null` when `features.emotion` is toggled off — no reserved space, content below snaps up instantly | Reserve a zero-height placeholder or animate `max-h` / `opacity` to 0 |
| 3 | HIGH | InitiativeBar | Returns `null` when `features.patient_initiative` is toggled off — similar snap reflow (4px, but noticeable under cursor) | Same as #2: animate height to 0 instead of unmount |
| 4 | MEDIUM | CaseSelect | Loading state shows "加载中..." centered text, not a skeleton matching the card grid (3-col layout) | Use `LoadingSkeleton variant="card"` in a matching grid layout |
| 5 | MEDIUM | TrainingEngine | Loading state shows spinner, not a skeleton matching the full training layout (header + chat + panel) | Render skeleton matching grid structure |
| 6 | MEDIUM | RecordDetail | Loading state shows spinner + "加载中..." text, not a skeleton matching the 4 stat cards + content | Use `LoadingSkeleton variant="stats"` + card skeleton |
| 7 | MEDIUM | PracticeSelectModal | Loading state shows `LoadingState` (spinner + text), but content switches to list instantly with no transition | Add fade-in transition on list mount |
| 8 | LOW | PanelHost (mobile) | Sets `document.body.style.overflow = "hidden"` — removes scrollbar, causes viewport width reflow | Use `overflow: clip` or account for scrollbar width |
| 9 | LOW | PanelHost collapse | CSS `transition-all duration-200` exists for width change; grid content reflows smoothly | Already adequate; no fix needed |
| 10 | LOW | ScoringOverlay | Has `animate-in fade-in-0` / `animate-out fade-out-0` with `duration-300` — adequate | No fix needed |
| 11 | LOW | ChatDisplay scroll | `scroll-smooth` on container; auto-scroll on new messages | No fix needed |
| 12 | LOW | EmotionIndicator pulse | `transition-colors duration-300` + pulse class; adequate | No fix needed |
| 13 | LOW | InitiativeBar fill | `transition-all duration-1000` on width change; adequate | No fix needed |
| 14 | LOW | PluginErrorBoundary | Shows friendly fallback with icon + plugin name | No fix needed |
| 15 | LOW | WelcomeScreen avatar | `w-20 h-20` explicit dimensions prevents image load shift | No fix needed |
| 16 | LOW | TrainingHeader avatar | `w-7 h-7 sm:w-9 sm:h-9` explicit dimensions | No fix needed |
| 17 | LOW | ChatInput send button | Replaces icon with spinner in same button area — no size change | No fix needed |
| 18 | LOW | RecordDetail CollapsibleSection | Collapse/expand has no animation; can add `grid-rows-[0_1fr]` transition | Optional: add CSS transition for collapsible height |

### Issue 1: Welcome ↔ Chat area transition lacks animation

**File**: `ChatArea.tsx:43-52`

The conditional switch between `WelcomeScreen` and `ChatDisplay` is a React ternary without any transition wrapper or CSS animation. The two components have different internal layouts — `WelcomeScreen` uses a centered card layout, `ChatDisplay` uses a scrollable message list. Switching between them causes an instant visual jump.

**Suggestion**: Wrap with a `<Transition>` or use CSS `@starting-style` / `animation: fadeIn` on mount. Alternatively, keep `WelcomeScreen` rendered and hidden behind the message list when messages arrive.

### Issue 2: EmotionIndicator unmounts on feature toggle

**File**: `EmotionIndicator.tsx:53`

```typescript
if (!features.emotion) return null;
```

When the user toggles off the emotion feature, the component fully unmounts. Since it has `border-b` and `py-1.5`, the layout shifts by ~32px instantly. The ChatInput below snaps up with no animation.

**Suggestion**: Replace `return null` with `return <div className="h-0 overflow-hidden transition-all duration-300" />` or animate `max-h` to 0.

### Issue 3: InitiativeBar unmounts on feature toggle

**File**: `InitiativeBar.tsx:23`

Same pattern as Issue 2 — returns `null` when `features.patient_initiative` is false. The bar is only 4px (`h-1`) but the cumulative shift with EmotionIndicator (38px total) is noticeable.

**Suggestion**: Same as Issue 2 — animate height to 0 instead of unmounting.

### Issue 4: CaseSelect loading state lacks skeleton grid

**File**: `CaseSelect.tsx:165-168`

Loading state shows "加载中..." text. After data loads, a 3-column grid of cards suddenly appears. The `LoadingSkeleton.tsx` component already supports `variant="card"` and `variant="stats"` but is not used here.

**Suggestion**:
```typescript
{isLoading ? (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 6 }).map((_, i) => (
      <LoadingSkeleton key={i} variant="card" />
    ))}
  </div>
) : ...}
```

### Issue 5: TrainingEngine loading uses spinner only

**File**: `TrainingEngine.tsx:292-298`

While `PatientProvider` fetches record data, a centered spinner is shown. This gives no hint of the final layout (header bar, chat area, side panel).

**Suggestion**: Render a skeleton grid matching the `grid-template-areas` layout: a header bar skeleton + a tall content area skeleton + a side panel skeleton.

### Issue 6: RecordDetail loading uses spinner only

**File**: `RecordDetail.tsx:167-176`

Shows spinner + "加载中..." text. The final page has 4 stat cards in a grid, then score sections and message replay.

**Suggestion**: Use `LoadingSkeleton variant="stats"` for the stat grid and additional card skeletons for the score/message sections.

### Issue 7: PracticeSelectModal content switches abruptly

**File**: `PracticeSelectModal.tsx:69-70`

Inside a Modal, `isLoading` shows `LoadingState` (spinner). When loading finishes, the practice list appears instantly.

**Suggestion**: Wrap the list container with a CSS fade-in animation on mount.

### Issue 8: Mobile PanelHost scrollbar removal

**File**: `PanelHost.tsx:30`

```typescript
document.body.style.overflow = "hidden";
```

When the panel opens on mobile, the body scrollbar disappears, causing the viewport to expand horizontally by ~17px (scrollbar width). This causes a layout reflow of the entire page.

**Suggestion**: Use `overflow: clip` instead, or set `padding-right: 17px` to compensate.

## Summary Checklist

- [ ] All loading states have skeleton or spinner — **Partially**: CaseSelect, TrainingEngine, RecordDetail only have text/spinner, no skeleton
- [ ] No sudden layout shifts on data load — **No**: CaseSelect cards pop in; Welcome → Chat switches abruptly
- [ ] Panel transitions are animated — **Yes**: `transition-all duration-200` on PanelHost width
- [ ] Chat area transitions are smooth — **No**: No animation on Welcome ↔ ChatDisplay switch
- [ ] Emotion/Initiative bars animate in/out — **No**: They `return null` on disable, causing snap reflow
- [ ] Error boundaries show friendly fallbacks — **Yes**: PluginErrorBoundary shows icon + plugin name
