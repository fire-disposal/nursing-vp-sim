import { useCallback, useEffect, useRef, useState } from "react";

export function useDebouncedSearch(defaultValue = "", delay = 200) {
	const [searchInput, setSearchInput] = useState(defaultValue);
	const [debouncedValue, setDebouncedValue] = useState(defaultValue);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	// useCallback：稳定引用，避免破坏下游 memo 组件
	const handleSearchChange = useCallback(
		(value: string) => {
			setSearchInput(value);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => setDebouncedValue(value), delay);
		},
		[delay],
	);

	return { searchInput, debouncedValue, handleSearchChange, setSearchInput };
}
