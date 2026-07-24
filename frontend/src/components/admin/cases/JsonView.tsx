import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useRef } from "react";
import type { CaseDispatch, CaseJsonValue } from "./CaseEditorState";

interface JsonViewProps {
	json: Record<string, CaseJsonValue>;
	dispatch: CaseDispatch;
}

export default function JsonView({ json, dispatch }: JsonViewProps) {
	const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

	const jsonText = JSON.stringify(json, null, 2);

	const handleMount: OnMount = useCallback((editor) => {
		editorRef.current = editor;
		editor.focus();
	}, []);

	const handleChange = useCallback(
		(value: string | undefined) => {
			if (!value) return;
			try {
				const parsed = JSON.parse(value);
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					dispatch({ type: "SET_JSON", json: parsed as Record<string, CaseJsonValue> });
				}
			} catch {
				// user is mid-typing — invalid JSON, don't update state
			}
		},
		[dispatch],
	);

	return (
		<div className="border border-border rounded-lg overflow-hidden" style={{ height: "calc(100vh - 280px)", minHeight: 360 }}>
			<Editor
				height="100%"
				defaultLanguage="json"
				value={jsonText}
				onChange={handleChange}
				onMount={handleMount}
				theme="vs-dark"
				options={{
					minimap: { enabled: false },
					lineNumbers: "on",
					scrollBeyondLastLine: false,
					fontSize: 13,
					tabSize: 2,
					formatOnPaste: true,
					automaticLayout: true,
				}}
			/>
		</div>
	);
}
