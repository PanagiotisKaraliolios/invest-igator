'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ModelPicker } from '@/app/(dashboard)/_components/chat/model-picker';
import { buildSelectorOptions } from '@/app/(dashboard)/_components/chat/use-chat-selector';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUpload } from '@/components/ui/file-upload';
import type { ModelSelector } from '@/server/ai/resolve-model';
import { api, type RouterOutputs } from '@/trpc/react';
import { type ReviewRowWithInclude, toBulkImportRows } from './import-flow.helpers';
import { ReviewTable } from './review-table';

type Preview = RouterOutputs['aiImport']['preview'];

/**
 * Owns the whole import lifecycle: pick a model, upload a CSV, preview its mapped rows, edit/
 * check them in `ReviewTable`, then bulk-commit via `transactions.bulkImport`.
 *
 * `platformConfigured` is passed down from the server page (env-derived, same source as
 * `(dashboard)/layout.tsx` feeds `ChatLauncher`) so the picker never defaults to an unusable
 * platform option; credentials are fetched eagerly (unlike the chat drawer's lazy, open-gated
 * fetch) since this page's whole point is choosing a model up front.
 */
export function ImportFlow({ platformConfigured }: { platformConfigured: boolean }) {
	const [selector, setSelector] = useState<ModelSelector>({ kind: 'platform' });
	const [files, setFiles] = useState<File[]>([]);
	const [rows, setRows] = useState<ReviewRowWithInclude[] | null>(null);
	const [stats, setStats] = useState<Preview['stats'] | null>(null);

	const credsQuery = api.aiCredentials.list.useQuery();
	const options = useMemo(
		() =>
			buildSelectorOptions(
				platformConfigured,
				(credsQuery.data ?? []).filter((c) => c.enabled)
			),
		[platformConfigured, credsQuery.data]
	);

	// Same repair as the chat launcher: the default `{ kind: 'platform' }` selector is unusable
	// when Azure isn't configured — fall back to the first BYOK option once credentials load.
	useEffect(() => {
		if (selector.kind === 'platform' && !platformConfigured && options.length > 0) {
			setSelector(options[0]!.value);
		}
	}, [options, platformConfigured, selector]);

	const utils = api.useUtils();
	const preview = api.aiImport.preview.useMutation({
		onError: (err) => toast.error(err.message || "Couldn't read this statement."),
		onSuccess: (data) => {
			setStats(data.stats);
			setRows(data.rows.map((r) => ({ ...r, include: r.status === 'ok' })));
		}
	});
	const commit = api.transactions.bulkImport.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to import transactions'),
		onSuccess: (res) => {
			toast.success(`Imported ${res.imported}${res.skipped ? `, skipped ${res.skipped} duplicate(s)` : ''}.`);
			void utils.transactions.invalidate();
			setRows(null);
			setStats(null);
			setFiles([]);
			preview.reset();
		}
	});

	// Single source of truth for both the button's count and its payload — the review table stays
	// dumb (it only ever hands back a new `rows` array) and this is the only place the "what
	// actually gets sent" filter lives.
	const toSend = useMemo(() => (rows ? toBulkImportRows(rows) : []), [rows]);

	const onFilesChange = (next: File[]) => {
		setFiles(next);
		const file = next[0];
		if (!file) return;
		void (async () => {
			try {
				const csv = await file.text();
				preview.mutate({ csv, model: selector });
			} catch {
				toast.error('Unable to read that file.');
			}
		})();
	};

	return (
		<div className='space-y-4'>
			<Card>
				<CardHeader>
					<CardTitle>1. Choose a model, then upload your CSV</CardTitle>
				</CardHeader>
				<CardContent className='space-y-4'>
					<ModelPicker onChange={setSelector} options={options} value={selector} />
					<FileUpload
						accept='.csv,text/csv'
						maxFiles={1}
						maxSize={5 * 1024 * 1024}
						onChange={onFilesChange}
						value={files}
					/>
					{preview.isPending && <p className='text-muted-foreground text-sm'>Reading statement…</p>}
				</CardContent>
			</Card>

			{rows && stats && (
				<Card>
					<CardHeader>
						<CardTitle>2. Review before importing</CardTitle>
					</CardHeader>
					<CardContent className='space-y-4'>
						<p className='text-muted-foreground text-sm'>
							{stats.total} rows — {stats.ok} ready, {stats.duplicate} duplicate, {stats.needsFix} need
							attention.
						</p>
						<ReviewTable onChange={setRows} rows={rows} />
						<div className='flex items-center gap-3'>
							<Button
								disabled={commit.isPending || toSend.length === 0}
								onClick={() => commit.mutate({ rows: toSend })}
							>
								{commit.isPending ? 'Importing…' : `Import ${toSend.length} selected`}
							</Button>
							<Link className='text-muted-foreground text-sm underline' href='/transactions'>
								Cancel
							</Link>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
