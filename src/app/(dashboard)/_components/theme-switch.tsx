'use client';

import { Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import { useTheme } from '@/components/theme/ThemeProvider';
import { Switch, SwitchIndicator, SwitchWrapper } from '@/components/ui/switch';

export default function ThemeSwitch({ isAuthenticated = false }: { isAuthenticated: boolean }) {
	// isAuthenticated currently unused; persistence handled by ThemeProvider higher in tree if provided
	const id = useId();
	const { isLight, setIsLight, mounted } = useTheme();
	return (
		<div className='flex items-center space-x-2.5'>
			<SwitchWrapper>
				<Switch
					aria-label='Toggle light/dark theme'
					checked={mounted ? isLight : undefined}
					id={id}
					onCheckedChange={(checked) => setIsLight(Boolean(checked))}
					size='md'
				/>
				<SwitchIndicator state='on'>
					<Sun className='size-4 text-primary-foreground' />
				</SwitchIndicator>
				<SwitchIndicator state='off'>
					<Moon className='size-4 text-muted-foreground' />
				</SwitchIndicator>
			</SwitchWrapper>
		</div>
	);
}
