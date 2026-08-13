import { Table as MantineTable, type TableProps } from "@mantine/core";
import type * as React from "react";

function Table({ className, ...props }: TableProps) {
	return <MantineTable className={className} {...props} />;
}

function TableHeader(props: React.ComponentProps<"thead">) {
	return <MantineTable.Thead {...props} />;
}

function TableBody(props: React.ComponentProps<"tbody">) {
	return <MantineTable.Tbody {...props} />;
}

function TableFooter(props: React.ComponentProps<"tfoot">) {
	return <MantineTable.Tfoot {...props} />;
}

function TableRow(props: React.ComponentProps<"tr">) {
	return <MantineTable.Tr {...props} />;
}

function TableHead(props: React.ComponentProps<"th">) {
	return <MantineTable.Th {...props} />;
}

function TableCell(props: React.ComponentProps<"td">) {
	return <MantineTable.Td {...props} />;
}

function TableCaption(props: React.ComponentProps<typeof MantineTable.Caption>) {
	return <MantineTable.Caption {...props} />;
}

export {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
};
