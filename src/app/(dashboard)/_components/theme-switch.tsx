'use client';

import { Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import { useTheme } from '@/components/theme/ThemeProvider';
import { Switch } from '@/components/ui/switch';

export default function ThemeSwitch() {
	const id = useId();
	const { isLight, setIsLight } = useTheme();
	return (
		<div className='flex items-center space-x-2.5'>
			<Sun className='size-4 text-muted-foreground' />
			{/* Base UI requires a stable controlled/uncontrolled choice: `isLight` is
			    always a boolean, so keep the Switch controlled for its whole lifetime
			    (Radix tolerated the undefined-until-mounted pattern; Base UI does not). */}
			<Switch
				aria-label='Toggle light/dark theme'
				checked={isLight}
				id={id}
				onCheckedChange={(checked) => setIsLight(Boolean(checked))}
			/>
			<Moon className='size-4 text-muted-foreground' />
		</div>
	);
}
