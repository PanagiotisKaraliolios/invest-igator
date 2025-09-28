'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useThemeSwitch } from '@/hooks/use-theme';

interface ThemeContextValue {
	theme: 'light' | 'dark';
	isLight: boolean;
	mounted: boolean;
	toggle: () => void;
	setTheme: (t: 'light' | 'dark') => void;
	setIsLight: (v: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({
	children,
	isAuthenticated = false,
	initialTheme
}: {
	children: React.ReactNode;
	isAuthenticated?: boolean;
	initialTheme?: 'light' | 'dark';
}) {
	const themeState = useThemeSwitch(isAuthenticated, initialTheme);
	const value = useMemo(
		() => ({
			isLight: themeState.isLight,
			mounted: themeState.mounted,
			setIsLight: themeState.setIsLight,
			setTheme: themeState.setTheme,
			theme: themeState.theme,
			toggle: themeState.toggle
		}),
		[
			themeState.theme,
			themeState.isLight,
			themeState.mounted,
			themeState.toggle,
			themeState.setTheme,
			themeState.setIsLight
		]
	);
	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
	return ctx;
}
