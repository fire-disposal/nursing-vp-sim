import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Box, Group, Stack, Text } from "@mantine/core";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useTrainingStore } from "@/stores/trainingStore";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { getTools, TOOL_META } from "./tools/registry";

const WIDE_PANEL_CAPS = new Set(["physical_exam", "nursing_record"]);
const PANEL_WIDTH_WIDE = 400;
const PANEL_WIDTH_DEFAULT = 300;

const ANIM_DURATION = 200; // ms

export function SceneRenderer() {
  const bus = useTrainingStore(s => s.bus)!;
  const capabilities = useTrainingStore(s => s.capabilities);
  const recordId = useTrainingStore(s => s.recordId);
  const trainingType = useTrainingStore(s => s.trainingType);
  const recordDetail = useTrainingStore(s => s.recordDetail);
  const tools = getTools(trainingType, capabilities);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const quizAutoOpenedRef = useRef(false);

  const toolProps: TrainingToolProps = { bus, recordId, recordDetail };


  useEffect(() => {
    const handler = (payload: { id: string }) => {
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      if (tools.some((t) => t.id === payload.id)) {
        if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
        setClosingId(null);
        setActiveId(payload.id);
      }
    };
    return bus.on("tool:open", handler);
  }, [bus, tools]);

  const handleClose = useCallback(() => {
    if (!activeId) return;
    setClosingId(activeId);
    closeTimerRef.current = setTimeout(() => {
      setActiveId(null);
      setClosingId(null);
      closeTimerRef.current = null;
    }, ANIM_DURATION);
  }, [activeId]);

	// Auto-open quiz tool on initial load when quiz capability is present
	useEffect(() => {
		if (quizAutoOpenedRef.current) return;
		if (capabilities.quiz && tools.some((t) => t.id === "quiz")) {
			quizAutoOpenedRef.current = true;
			setActiveId("quiz");
		}
	}, [capabilities.quiz, tools]);

	// Cleanup timer on unmount
	useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  if (tools.length === 0) return null;

	const showPanel = activeId || closingId;
  const displayTool = tools.find((c) => c.id === (closingId || activeId));

  return (
    <Box display={{ base: "none", lg: "flex" }} style={{ flexShrink: 0, height: "100%" }}>
      {/* Panel — always mounted during animation, width: 0 when closed */}
      <Box
        style={{
          width: showPanel && displayTool ? panelWidth(displayTool) : 0,
          transition: `width ${ANIM_DURATION}ms ease-out`,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
          overflow: "hidden",
          paddingTop: 44,
          opacity: showPanel ? 1 : 0,
        }}
      >
        {showPanel && displayTool && (
          <>
            <Group
              justify="space-between"
              wrap="nowrap"
              px="sm"
              py={8}
              style={{
                borderBottom: "1px solid var(--mantine-color-default-border)",
                background: "var(--mantine-color-gray-0)",
                flexShrink: 0,
              }}
            >
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                {(() => {
                  const Icon = TOOL_META[displayTool.id]?.icon;
                  return Icon ? <Icon size={14} style={{ flexShrink: 0 }} /> : null;
                })()}
                <Text size="xs" fw={500} c="dimmed" truncate>
                  {TOOL_META[displayTool.id]?.title ?? displayTool.id}
                </Text>
              </Group>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleClose}
                title="收起面板"
                aria-label="收起面板"
              >
                ✕
              </ActionIcon>
            </Group>
            <Box style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
              <Suspense fallback={<Box h={80} />}>
                <SceneStateProvider bus={bus}>
                  <ErrorBoundary fallback={
                    <Stack align="center" gap={8} p="md">
                      <Text size="sm" c="dimmed">卡片加载失败</Text>
                    </Stack>
                  }>
                    <displayTool.component {...toolProps} />
                  </ErrorBoundary>
                </SceneStateProvider>
              </Suspense>
            </Box>
          </>
        )}
      </Box>

      {/* Icon rail */}
      <Box
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          borderLeft: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
          padding: "8px 4px",
          height: "100%",
          overflowY: "auto",
        }}
      >
        {tools.map((tool) => {
          const isActive = tool.id === activeId;
          const Icon = TOOL_META[tool.id]?.icon;
          return (
            <ActionIcon
              key={tool.id}
              variant={isActive ? "light" : "default"}
              color={isActive ? undefined : "gray"}
              size={36}
              radius="md"
              onClick={() => isActive ? handleClose() : setActiveId(tool.id)}
              title={TOOL_META[tool.id]?.title ?? tool.id}
            >
              {Icon ? <Icon size={16} /> : null}
            </ActionIcon>
          );
        })}
      </Box>
    </Box>
  );
}

function panelWidth(tool: { capability?: string }) {
  return tool.capability && WIDE_PANEL_CAPS.has(tool.capability) ? PANEL_WIDTH_WIDE : PANEL_WIDTH_DEFAULT;
}
