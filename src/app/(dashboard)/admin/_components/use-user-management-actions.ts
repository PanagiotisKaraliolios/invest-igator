'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { api } from '@/trpc/react';

export function useUserManagementActions() {
	const router = useRouter();
	const utils = api.useUtils();
	const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
	const [banUser, setBanUser] = useState<{ id: string; email: string } | null>(null);

	// Mutations
	const setRoleMutation = api.admin.setRole.useMutation({
		onError: (error) => {
			toast.error(error.message || 'Failed to update user role');
		},
		onSuccess: () => {
			toast.success('User role updated successfully');
			void utils.admin.listUsers.invalidate();
			void utils.admin.getAuditLogs.invalidate();
			router.refresh();
		}
	});

	const banUserMutation = api.admin.banUser.useMutation({
		onError: (error) => {
			toast.error(error.message || 'Failed to ban user');
		},
		onSuccess: () => {
			toast.success('User banned successfully');
			void utils.admin.listUsers.invalidate();
			void utils.admin.getAuditLogs.invalidate();
			router.refresh();
		}
	});

	const unbanUserMutation = api.admin.unbanUser.useMutation({
		onError: (error) => {
			toast.error(error.message || 'Failed to unban user');
		},
		onSuccess: () => {
			toast.success('User unbanned successfully');
			void utils.admin.listUsers.invalidate();
			void utils.admin.getAuditLogs.invalidate();
			router.refresh();
		}
	});

	const removeUserMutation = api.admin.removeUser.useMutation({
		onError: (error) => {
			toast.error(error.message || 'Failed to delete user');
		},
		onSuccess: () => {
			toast.success('User deleted successfully');
			setDeleteUserId(null);
			void utils.admin.listUsers.invalidate();
			void utils.admin.getAuditLogs.invalidate();
			router.refresh();
		}
	});

	// Action handlers
	const handleSetRole = (userId: string, newRole: 'superadmin' | 'admin' | 'user') => {
		setRoleMutation.mutate({ role: newRole, userId });
	};

	const handleBanUser = (userId: string, email: string) => {
		setBanUser({ email, id: userId });
	};

	const handleConfirmBan = (reason?: string) => {
		if (banUser) {
			banUserMutation.mutate({ banReason: reason, userId: banUser.id });
			setBanUser(null);
		}
	};

	const handleUnbanUser = (userId: string) => {
		unbanUserMutation.mutate({ userId });
	};

	const handleDeleteUser = (userId: string) => {
		removeUserMutation.mutate({ userId });
	};

	const handleImpersonateUser = async (userId: string) => {
		try {
			const result = await authClient.admin.impersonateUser({ userId });

			if (result.error) {
				toast.error(result.error.message || 'Failed to impersonate user');
				return;
			}

			toast.success('Now impersonating user');

			// Hard navigation to ensure server components refetch with updated session
			window.location.href = '/portfolio';
		} catch (error) {
			toast.error('Failed to impersonate user');
			console.error('Impersonation error:', error);
		}
	};

	return {
		banUser,
		deleteUserId,
		handleBanUser,
		handleConfirmBan,
		handleDeleteUser,
		handleImpersonateUser,
		handleSetRole,
		handleUnbanUser,
		setBanUser,
		setDeleteUserId
	};
}
