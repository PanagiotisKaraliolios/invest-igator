'use client';

import { columns } from './columns';
import { DataTable } from './data-table';

export default function TransactionsTable() {
	return <DataTable columns={columns} />;
}
