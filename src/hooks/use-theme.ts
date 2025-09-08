"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/trpc/react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	if (theme === "dark") root.classList.add("dark");
	else root.classList.remove("dark");
}

export function useThemeSwitch() {
	const [mounted, setMounted] = useState(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const skipNextPersistRef = useRef(false);
	const initializedFromRemoteRef = useRef(false);
	const setThemeMutation = api.theme.setTheme.useMutation();
	const mutateRef = useRef<(t: Theme) => void>(() => {});
	useEffect(() => {
		mutateRef.current = (t: Theme) => setThemeMutation.mutate(t);
	}, [setThemeMutation]);
	const getThemeQuery = api.theme.getTheme.useQuery(undefined, {
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: false,
		retry: false,
	});

	// Initialize from SSR-applied class which comes from the session
	const [theme, _setTheme] = useState<Theme>(() => {
		if (typeof document !== "undefined") {
			return document.documentElement.classList.contains("dark")
				? "dark"
				: "light";
		}
		return "dark"; // server fallback; will sync on mount
	});

	// Apply to DOM and debounce persistence to API
	useEffect(() => {
		applyTheme(theme);
		setMounted(true);

		if (skipNextPersistRef.current) {
			// First sync from remote; don't re-persist the same value back
			skipNextPersistRef.current = false;
			return;
		}

		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			mutateRef.current(theme);
		}, 3000);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [theme]);

	const setTheme = useCallback((t: Theme) => {
		_setTheme(t);
		try {
			// Persist to cookie for SSR; 1 year expiry
			document.cookie = `ui-theme=${t}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
		} catch {
			// ignore cookie errors
		}
	}, []);

	// Initialize from DB via API once; align cookie and UI without re-persisting
	useEffect(() => {
		if (!getThemeQuery.isSuccess || initializedFromRemoteRef.current) return;
		initializedFromRemoteRef.current = true;
		const rt = getThemeQuery.data?.theme;
		if (rt && rt !== theme) {
			skipNextPersistRef.current = true;
			setTheme(rt);
		}
	}, [getThemeQuery.isSuccess, getThemeQuery.data?.theme, theme, setTheme]);

	const isLight = useMemo(() => theme === "light", [theme]);
	const setIsLight = useCallback((val: boolean) => {
		setTheme(val ? "light" : "dark");
	}, [setTheme]);
	const toggle = useCallback(
		() => setTheme(theme === "dark" ? "light" : "dark"),
		[setTheme, theme],
	);

	return { theme, setTheme, isLight, setIsLight, toggle, mounted } as const;
}
