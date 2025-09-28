'use client';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useTheme } from '@/components/theme/ThemeProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ThemeCard({ initialTheme }: { initialTheme?: 'light' | 'dark' }) {
	const { theme, setTheme } = useTheme();
	const first = useRef(true);

	// Sync provided initialTheme (from server) once if differs
	useEffect(() => {
		if (!initialTheme || first.current === false) return;
		first.current = false;
		if (initialTheme !== theme) setTheme(initialTheme);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialTheme]);

	// Provide optimistic feedback immediately on change
	const handleChange = (v: 'light' | 'dark') => {
		if (v === theme) return;
		setTheme(v);
		toast.success('Theme updated');
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Theme</CardTitle>
			</CardHeader>
			<CardContent className='space-y-2'>
				<Label>Appearance</Label>
				<Select onValueChange={handleChange} value={theme}>
					<SelectTrigger className='w-[220px]' data-testid='theme-select'>
						<SelectValue placeholder='Select theme' />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='light'>Light</SelectItem>
						<SelectItem value='dark'>Dark</SelectItem>
					</SelectContent>
				</Select>
			</CardContent>
		</Card>
	);
}
