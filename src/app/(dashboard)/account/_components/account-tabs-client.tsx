'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { Tabs } from '@/components/ui/tabs';

type Props = {
	children: React.ReactNode;
	defaultValue: string;
	valid: string[];
};

export default function AccountTabsClient({ children, defaultValue, valid }: Props) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const current = searchParams.get('tab') ?? defaultValue;
	const value = useMemo(() => (valid.includes(current) ? current : defaultValue), [current, defaultValue, valid]);

	const setTab = (next: string) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set('tab', next);
		router.replace(`${pathname}?${params.toString()}`);
	};

	// Ensure the param is present on first load
	useEffect(() => {
		if (!searchParams.get('tab')) setTab(value);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<Tabs className='w-full' onValueChange={setTab} value={value}>
			{children}
		</Tabs>
	);
}
