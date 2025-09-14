'use client';

import { Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import { Switch, SwitchIndicator, SwitchWrapper } from '@/components/ui/switch';
import { useThemeSwitch } from '@/hooks/use-theme';

export default function ThemeSwitch({ isAuthenticated = false }: { isAuthenticated: boolean }) {
	const id = useId();
	const { isLight, setIsLight, mounted } = useThemeSwitch(isAuthenticated);
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
