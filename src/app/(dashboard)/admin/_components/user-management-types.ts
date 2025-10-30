export type User = {
	id: string;
	email: string;
	name: string | null;
	role: string;
	banned: boolean;
	banReason: string | null | undefined;
	emailVerified: boolean;
	createdAt: string;
};
