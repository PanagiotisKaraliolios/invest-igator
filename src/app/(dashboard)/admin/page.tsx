import { redirect } from 'next/navigation';

export default async function AdminPage() {
	// Redirect to users page as default admin landing
	redirect('/admin/users');
}
