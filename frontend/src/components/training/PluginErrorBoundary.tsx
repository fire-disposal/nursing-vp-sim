import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
	pluginName: string;
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

export class PluginErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	componentDidCatch(error: Error) {
		console.error(
			`[PluginErrorBoundary] ${this.props.pluginName}:`,
			error,
		);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex flex-col items-center justify-center p-4 text-center text-muted-foreground">
					<AlertTriangle className="size-8 mb-2 text-destructive" />
					<p className="text-xs font-medium">插件加载失败</p>
					<p className="text-[10px] mt-1">{this.props.pluginName}</p>
				</div>
			);
		}
		return this.props.children;
	}
}
