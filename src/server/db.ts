import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/generated';

import { env } from '@/env';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const createPrismaClient = () =>
	new PrismaClient({
		adapter,
		log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
	});

const globalForPrisma = globalThis as unknown as {
	prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
