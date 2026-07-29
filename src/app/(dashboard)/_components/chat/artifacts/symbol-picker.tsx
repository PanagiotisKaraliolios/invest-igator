'use client';

import { type ReactNode, useState } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
// `import type` only — erased at compile time, so the tool module (and its server import
// chain) never enters the client bundle. Same boundary trick as confirm-card.
import type { symbolSearchTool } from '@/server/ai/tools/symbol-search';
import { useChatActions } from '../chat-actions';
import { pickMessage } from './symbol-picker.helpers';

type SearchOutput = z.infer<typeof symbolSearchTool.outputSchema>;

/**
 * The candidate listings for an ambiguous symbol, as clickable rows. One fund lists on several
 * exchanges (VUAA.L, VUAA.DE, VUAA.MI are all the same Vanguard ETF), and only the user knows
 * which one they hold — so the model presents, and the user picks.
 *
 * Clicking sends a normal user turn naming the ticker; the model then continues with an exact
 * symbol. Nothing here writes to the app.
 *
 * The picker renders as soon as its part reaches `output-available` — typically WHILE the
 * assistant is still streaming the prose that introduces the candidates, not after. Clicking
 * mid-stream is therefore the normal case, not an edge case, so the candidate buttons are
 * disabled whenever a turn is already in flight (`actions.busy`) — otherwise `sendMessage` would
 * start a second concurrent request for the same chat.
 */
export function SymbolPicker({ output }: { output: unknown }): ReactNode {
	const out = output as SearchOutput | null;
	const actions = useChatActions();
	const [picked, setPicked] = useState<string | null>(null);

	if (!out || !Array.isArray(out.candidates) || out.candidates.length === 0) {
		return <p className='text-muted-foreground text-xs'>No matching listings found.</p>;
	}

	if (picked !== null) {
		return <p className='text-xs'>✓ Using {picked}.</p>;
	}

	return (
		<div className='space-y-2'>
			<p className='text-muted-foreground text-xs'>
				{out.candidates.length} listing{out.candidates.length === 1 ? '' : 's'} matched “{out.query}”. Pick the
				one you mean:
			</p>
			<div className='flex flex-col gap-1'>
				{out.candidates.map((c) => (
					<Button
						className='h-auto justify-start py-1.5 text-left'
						disabled={actions === null || actions.busy}
						key={c.symbol}
						onClick={() => {
							setPicked(c.symbol);
							actions?.sendMessage(pickMessage(c.symbol));
						}}
						size='sm'
						type='button'
						variant='outline'
					>
						<span className='font-medium'>{c.symbol}</span>
						<span className='text-muted-foreground text-xs'>
							{c.exchange}
							{c.name ? ` · ${c.name}` : ''}
						</span>
					</Button>
				))}
			</div>
			{out.truncated ? (
				<p className='text-muted-foreground text-xs'>More listings exist — narrow the name to see others.</p>
			) : null}
		</div>
	);
}
