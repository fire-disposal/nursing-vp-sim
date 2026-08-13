import type * as React from "react";

function Label({ className, ...props }: React.ComponentProps<"label">) {
	return <label className={className} {...props} />;
}

export { Label };
