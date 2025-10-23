'use client';

import { Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import { useTheme } from '@/components/theme/ThemeProvider';
import { Switch } from '@/components/ui/switch';

export default function ThemeSwitch() {
	const id = useId();
	const { isLight, setIsLight, mounted } = useTheme();
	return (
		<div className='flex items-center space-x-2.5'>
			<Sun className='size-4 text-muted-foreground' />
			<Switch
				aria-label='Toggle light/dark theme'
				checked={mounted ? isLight : undefined}
				id={id}
				onCheckedChange={(checked) => setIsLight(Boolean(checked))}
			/>
			<Moon className='size-4 text-muted-foreground' />
		</div>
	);
}
