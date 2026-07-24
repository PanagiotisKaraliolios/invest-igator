import type { Metadata } from 'next';
import { env } from '@/env';
import { ImportFlow } from './_components/import-flow';

export const metadata: Metadata = { title: 'Import statement' };

export default function ImportPage() {
	// Same derivation as `(dashboard)/layout.tsx`'s `ChatLauncher` wiring: the platform (Azure)
	// model is only offered when Azure OpenAI is fully configured; otherwise `ImportFlow` falls
	// back to the user's own BYOK providers.
	const platformConfigured = Boolean(
		env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_RESOURCE_NAME && env.AZURE_OPENAI_CHAT_DEPLOYMENT
	);

	return (
		<div className='mx-auto max-w-5xl space-y-6 p-4'>
			<div>
				<h1 className='font-semibold text-2xl'>Import a broker statement</h1>
				<p className='text-muted-foreground text-sm'>
					Upload a CSV export from your broker. We map its columns, flag duplicates, and let you review every
					row before anything is saved.
				</p>
			</div>
			<ImportFlow platformConfigured={platformConfigured} />
		</div>
	);
}
