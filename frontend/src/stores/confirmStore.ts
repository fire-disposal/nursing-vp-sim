import { create } from "zustand";
import type { ConfirmOptions } from "@/components/ui/confirm";

interface PendingConfirm extends ConfirmOptions {
	resolve: (value: boolean) => void;
}

interface ConfirmState {
	current: PendingConfirm | null;
	confirm: (options: ConfirmOptions) => Promise<boolean>;
	closeConfirm: (value: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
	current: null,
	confirm: (options) => {
		const existing = get().current;
		if (existing) existing.resolve(false);
		return new Promise<boolean>((resolve) => {
			set({ current: { ...options, resolve } });
		});
	},
	closeConfirm: (value) => {
		const pending = get().current;
		pending?.resolve(value);
		set({ current: null });
	},
}));
