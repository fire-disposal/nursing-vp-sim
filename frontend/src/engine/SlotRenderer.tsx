import type { ComponentType } from "react";
import { Component } from "react";
import type { SlotDefinition, SlotName, SlotProps, TrainingPlugin } from "./types";

class SlotErrorBoundary extends Component<{ children: React.ReactNode; name: string }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e };
  }
  componentDidCatch(e: Error) {
    console.warn(`[SlotErrorBoundary] slot=${this.props.name}:`, e.message);
  }
  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

interface SlotRendererProps {
  name: SlotName;
  plugins: TrainingPlugin[];
  definition: SlotDefinition;
  slotProps: SlotProps;
}

export function SlotRenderer({ name, plugins, definition, slotProps }: SlotRendererProps) {
  const candidates = plugins.filter((p) => p.slots?.[name]);

  if (candidates.length === 0) return null;

  return (
    <div className="slot-container" data-slot={name} data-render={definition.render}>
      {candidates.map((plugin) => {
        const Component = plugin.slots![name] as ComponentType<SlotProps>;
        return (
          <SlotErrorBoundary key={plugin.id} name={name}>
            <Component {...slotProps} />
          </SlotErrorBoundary>
        );
      })}
    </div>
  );
}
