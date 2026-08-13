import { TextInput, type TextInputProps } from "@mantine/core";

function Input({ className, ...props }: TextInputProps) {
	return <TextInput className={className} {...props} />;
}

export { Input };
