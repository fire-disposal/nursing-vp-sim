import type { ComponentType } from "react";
import type { SlotDefinition, SlotName, SlotProps, TrainingPlugin } from "./types";

interface SlotRendererProps {
  name: SlotName;
  plugins: TrainingPlugin[];
  definition: SlotDefinition;
  slotProps: SlotProps;
}

export function SlotRenderer({ name, plugins, definition, slotProps }: SlotRendererProps) {
  const candidates = plugins.filter((p) => p.slots?.[name]).sort((a, b) => (a.slots![name]?.priority ?? 99) - (b.slots![name]?.priority ?? 99));

  if (candidates.length === 0) return null;

  return (
    <div className="slot-container" data-slot={name} data-render={definition.render}>
      {candidates.map((plugin) => {
        const Component = plugin.slots![name] as ComponentType<SlotProps>;
        return <Component key={plugin.id} {...slotProps} />;
      })}
    </div>
  );
}
