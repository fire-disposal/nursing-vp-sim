import { Textarea as MantineTextarea, type TextareaProps } from "@mantine/core";

function Textarea({ className, ...props }: TextareaProps) {
	return <MantineTextarea autosize={false} minRows={3} className={className} {...props} />;
}

export { Textarea };
