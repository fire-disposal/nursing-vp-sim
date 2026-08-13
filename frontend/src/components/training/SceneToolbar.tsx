/**
 * SceneToolbar — 移动端场景工具按钮栏
 *
 * 渲染在 ChatInput 上方，隐藏于大屏桌面端（lg:hidden）。
 * 点击图标打开对应的 Bottomsheet 面板。
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { ActionIcon, Box, Stack, Text } from "@mantine/core";
import ErrorBoundary from "@/components/ErrorBoundary";
import Bottomsheet from "@/components/ui/bottomsheet";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { useTrainingStore } from "@/stores/trainingStore";
import type { TrainingTool, TrainingToolProps } from "@/engine/TrainingTool";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { getTools, TOOL_META } from "./tools/registry";

export default function SceneToolbar() {
  const bus = useTrainingStore(s => s.bus)!;
  const capabilities = useTrainingStore(s => s.capabilities);
  const trainingType = useTrainingStore(s => s.trainingType);
  const recordId = useTrainingStore(s => s.recordId);
  const recordDetail = useTrainingStore(s => s.recordDetail);
  const tools: TrainingTool[] = getTools(trainingType, capabilities);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeTool = tools.find((c) => c.id === activeId);
  const toolProps: TrainingToolProps = { bus, recordId, recordDetail };

  const handleClose = useCallback(() => setActiveId(null), []);


  useEffect(() => {
    const handler = (payload: { id: string }) => {
      if (window.matchMedia("(min-width: 1024px)").matches) return;
      if (tools.some((t) => t.id === payload.id)) setActiveId(payload.id);
    };
    return bus.on("tool:open", handler);
  }, [bus, tools]);

  if (tools.length === 0) return null;

  return (
    <>
      {/* Horizontal icon toolbar — placed above chat input on mobile */}
      <Box
        display={{ base: "flex", lg: "none" }}
        style={{
          alignItems: "center",
          gap: 4,
          padding: "4px 6px",
          borderTop: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        {tools.map((tool) => {
          const isActive = tool.id === activeId;
          const cap = tool.capability ? ALL_CAPABILITIES[tool.capability] : null;
          const Icon = TOOL_META[tool.id]?.icon;
          return (
            <ActionIcon
              key={tool.id}
              variant={isActive ? "light" : "default"}
              color={isActive ? undefined : "gray"}
              size={44}
              radius="md"
              onClick={() => setActiveId(isActive ? null : tool.id)}
              title={cap?.label ?? TOOL_META[tool.id]?.title ?? tool.id}
              aria-label={TOOL_META[tool.id]?.title ?? tool.id}
              style={{ flexShrink: 0 }}
            >
              {Icon ? <Icon size={16} /> : null}
            </ActionIcon>
          );
        })}
      </Box>

      {/* Bottomsheet panel */}
      {activeTool && (
        <Bottomsheet open onClose={handleClose} title={TOOL_META[activeTool.id]?.title ?? activeTool.id}>
          <Suspense fallback={<Box h={80} />}>
            <SceneStateProvider bus={bus}>
              <ErrorBoundary
                fallback={
                  <Stack align="center" gap={8} p="md">
                    <Text size="sm" c="dimmed">卡片加载失败</Text>
                  </Stack>
                }
              >
                <activeTool.component {...toolProps} />
              </ErrorBoundary>
            </SceneStateProvider>
          </Suspense>
        </Bottomsheet>
      )}
    </>
  );
}
