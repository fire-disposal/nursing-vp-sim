import { AlertTriangle } from "lucide-react";
import { Component, type ReactNode } from "react";

interface Props {
	panelName: string;
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

export class PanelErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	componentDidCatch(error: Error) {
		console.error(
			`[PanelErrorBoundary] ${this.props.panelName}:`,
			error,
		);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex flex-col items-center justify-center p-4 text-center text-muted-foreground">
					<AlertTriangle className="size-8 mb-2 text-destructive" />
					<p className="text-xs font-medium">面板加载失败</p>
					<p className="text-[10px] mt-1">{this.props.panelName}</p>
				</div>
			);
		}
		return this.props.children;
	}
}
