'use client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/trpc/react';

export default function ThemeCard({ initialTheme }: { initialTheme?: 'light' | 'dark' }) {
	const utils = api.useContext();
	const setTheme = api.theme.setTheme.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to update theme'),
		onSuccess: async () => {
			await utils.theme.getTheme.invalidate();
			toast.success('Theme updated');
		}
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Theme</CardTitle>
			</CardHeader>
			<CardContent className='space-y-2'>
				<Label>Appearance</Label>
				<Select defaultValue={initialTheme} onValueChange={(v: 'light' | 'dark') => setTheme.mutate(v)}>
					<SelectTrigger className='w-[220px]'>
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
