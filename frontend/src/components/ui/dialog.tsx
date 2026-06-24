import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={cn(
				"fixed inset-0 isolate z-50 bg-black/30 backdrop-blur-xs duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
				className,
			)}
			{...props}
		/>
	);
}

const DIALOG_SIZE_WIDTH: Record<
	"dialog" | "alert" | "confirm",
	Record<"sm" | "md" | "lg", number>
> = {
	dialog: { sm: 400, md: 480, lg: 640 },
	alert: { sm: 360, md: 420, lg: 480 },
	confirm: { sm: 360, md: 420, lg: 480 },
};

function DialogContent({
	className,
	children,
	variant = "dialog",
	size = "md",
	showCloseButton,
	maxWidth,
	title,
	style,
	...props
}: DialogPrimitive.Popup.Props & {
	variant?: "dialog" | "alert" | "confirm";
	size?: "sm" | "md" | "lg";
	showCloseButton?: boolean;
	maxWidth?: number;
	title?: React.ReactNode;
}) {
	const showClose = showCloseButton ?? variant === "dialog";
	const computedMaxWidth = maxWidth ?? DIALOG_SIZE_WIDTH[variant][size];
	const centeredHeader = variant !== "dialog";

	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Popup
				data-slot="dialog-content"
				data-variant={variant}
				data-size={size}
				className={cn(
					"fixed top-1/2 left-1/2 z-50 grid max-h-[85vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none data-open:duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:duration-200 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0",
					className,
				)}
				style={{ maxWidth: computedMaxWidth, ...style }}
				{...props}
			>
				{title != null && (
					<DialogHeader
						className={cn(
							centeredHeader && "items-center place-items-center text-center",
						)}
					>
						<DialogTitle>{title}</DialogTitle>
					</DialogHeader>
				)}
				{children}
				{showClose && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						render={
							<Button
								variant="ghost"
								className="absolute top-3 right-3 size-9 rounded-lg hover:bg-muted"
								size="icon-sm"
							/>
						}
					>
						<XIcon />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn("flex flex-col gap-2", className)}
			{...props}
		/>
	);
}

function DialogFooter({
	className,
	showCloseButton = false,
	children,
	...props
}: React.ComponentProps<"div"> & {
	showCloseButton?: boolean;
}) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				"-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 px-6 py-4 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogPrimitive.Close render={<Button variant="outline" />}>
					Close
				</DialogPrimitive.Close>
			)}
		</div>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn(
				"font-heading text-base leading-none font-medium",
				className,
			)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn(
				"text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function DialogMedia({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-media"
			className={cn(
				"mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted *:[svg:not([class*='size-'])]:size-6",
				className,
			)}
			{...props}
		/>
	);
}

function DialogAction({
	className,
	...props
}: React.ComponentProps<typeof Button>) {
	return (
		<Button data-slot="dialog-action" className={cn(className)} {...props} />
	);
}

function DialogCancel({
	className,
	variant = "outline",
	size = "default",
	...props
}: DialogPrimitive.Close.Props &
	Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
	return (
		<DialogPrimitive.Close
			data-slot="dialog-cancel"
			className={cn(className)}
			render={<Button variant={variant} size={size} />}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogAction,
	DialogCancel,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogMedia,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
