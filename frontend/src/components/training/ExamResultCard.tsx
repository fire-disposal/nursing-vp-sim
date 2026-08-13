// Waves（lucide，SpO₂ 波形）在 tabler 无同名图标，语义上取 IconWaveSine（正弦波）。
import { IconActivity, IconDroplets, IconHeart, IconThermometer, IconWaveSine } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Box, Group, Text } from "@mantine/core";

interface VitalSignResult {
  type: string;
  data: Record<string, unknown>;
}

interface ExamResultCardProps {
  result: VitalSignResult;
  className?: string;
}

const ICON_MAP: Record<string, ReactNode> = {
  vitals: <IconHeart size={16} color="var(--mantine-color-red-5)" />,
  bp: <IconActivity size={16} color="var(--mantine-color-blue-5)" />,
  temp: <IconThermometer size={16} color="var(--mantine-color-orange-5)" />,
  spo2: <IconWaveSine size={16} color="var(--mantine-color-cyan-5)" />,
  hr: <IconHeart size={16} color="var(--mantine-color-red-5)" />,
  rr: <IconActivity size={16} color="var(--mantine-color-blue-5)" />,
  skin: <IconDroplets size={16} color="var(--mantine-color-yellow-5)" />,
  pain: <IconActivity size={16} color="var(--mantine-color-violet-5)" />,
};

const TYPE_LABELS: Record<string, string> = {
  vitals: "生命体征",
  bp: "血压",
  temp: "体温",
  spo2: "血氧",
  hr: "心率",
  rr: "呼吸",
  skin: "皮肤",
  pain: "疼痛",
};

export function ExamResultCard({ result, className }: ExamResultCardProps) {
  const label = String(result.data?.label || result.type);
  const value = String(result.data?.value ?? "");
  const unit = String(result.data?.unit ?? "");
  const icon = ICON_MAP[result.type] || <IconActivity size={16} color="var(--mantine-color-dimmed)" />;

  return (
    <Group justify="flex-end" px="md">
      <Group
        gap={12}
        px="md"
        py={10}
        wrap="nowrap"
        className={className}
        style={{
          borderRadius: 12,
          border: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
          boxShadow: "var(--mantine-shadow-xs)",
        }}
      >
        <Box
          w={36}
          h={36}
          style={{
            borderRadius: 8,
            background: "var(--mantine-color-gray-1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </Box>
        <Box>
          <Text
            size="10px"
            fw={500}
            tt="uppercase"
            c="dimmed"
            style={{ letterSpacing: "0.05em" }}
          >
            {TYPE_LABELS[result.type] || label}
          </Text>
          <Text fw={700} size="lg" lh={1.2} style={{ fontVariantNumeric: "tabular-nums" }}>
            {value}
            {unit && (
              <Text component="span" size="xs" c="dimmed" fw={400} ml={2}>{unit}</Text>
            )}
          </Text>
        </Box>
      </Group>
    </Group>
  );
}
