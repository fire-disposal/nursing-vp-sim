import { useEffect, useRef, useState } from "react";

export function useDebouncedSearch(defaultValue = "", delay = 200) {
	const [searchInput, setSearchInput] = useState(defaultValue);
	const [debouncedValue, setDebouncedValue] = useState(defaultValue);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	const handleSearchChange = (value: string) => {
		setSearchInput(value);
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => setDebouncedValue(value), delay);
	};

	return { searchInput, debouncedValue, handleSearchChange, setSearchInput };
}
