import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '@/env';

// Lazy initialization to avoid issues with circular dependencies
let r2Client: S3Client | null = null;

function getR2Client(): S3Client {
	if (!r2Client) {
		r2Client = new S3Client({
			credentials: {
				accessKeyId: env.CLOUDFLARE_ACCESS_KEY_ID,
				secretAccessKey: env.CLOUDFLARE_SECRET_ACCESS_KEY
			},
			endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
			region: 'auto'
		});
	}
	return r2Client;
}

export interface UploadResult {
	url: string;
	key: string;
}

/**
 * Upload a file to Cloudflare R2
 *
 * @param file Buffer containing the file data
 * @param key The object key (path) in the bucket
 * @param contentType MIME type of the file
 * @returns Upload result with public URL and key
 */
export async function uploadToR2(file: Buffer, key: string, contentType: string): Promise<UploadResult> {
	try {
		const client = getR2Client();

		console.log(`[R2] Uploading ${key} (${(file.length / 1024).toFixed(2)}KB, ${contentType})`);

		const command = new PutObjectCommand({
			Body: file,
			Bucket: env.CLOUDFLARE_BUCKET_NAME,
			ContentType: contentType,
			Key: key
		});

		await client.send(command);

		// Generate public URL
		// Option 1: Use custom public domain (set via CLOUDFLARE_R2_PUBLIC_URL env var)
		// Option 2: Use R2.dev subdomain (format: https://<bucket>.<account-id>.r2.cloudflarestorage.com/<key>)
		// Note: Bucket must be public for direct access, or use signed URLs for private buckets
		let url: string;

		if (env.CLOUDFLARE_R2_PUBLIC_URL) {
			// Custom domain configured (e.g., https://cdn.example.com)
			url = `${env.CLOUDFLARE_R2_PUBLIC_URL}/${key}`;
		} else {
			// Use R2's public bucket URL format (requires bucket to have public access enabled)
			// Format: https://<bucket-name>.<account-id>.r2.cloudflarestorage.com/<key>
			url = `https://${env.CLOUDFLARE_BUCKET_NAME}.${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
		}

		console.log(`[R2] Upload successful: ${url}`);

		return { key, url };
	} catch (error) {
		console.error('[R2] Upload failed:', error);
		throw new Error(`R2 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

/**
 * Generate a unique file key for profile pictures
 * @param userId User ID
 * @param extension File extension (e.g., 'jpg', 'png')
 * @returns Unique file key
 */
export function generateProfilePictureKey(userId: string, extension: string): string {
	const timestamp = Date.now();
	return `profile-pictures/${userId}/${timestamp}.${extension}`;
}

/**
 * Convert a base64 data URL to a Buffer
 * @param dataUrl Base64 data URL (e.g., "data:image/png;base64,...")
 * @returns Object with buffer and content type
 */
export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string } {
	// Use indexOf instead of regex for better performance with large strings
	const dataPrefix = 'data:';
	const base64Marker = ';base64,';

	if (!dataUrl.startsWith(dataPrefix)) {
		throw new Error('Invalid data URL format: must start with "data:"');
	}

	const base64Index = dataUrl.indexOf(base64Marker);
	if (base64Index === -1) {
		throw new Error('Invalid data URL format: missing ";base64," marker');
	}

	const contentType = dataUrl.substring(dataPrefix.length, base64Index);
	const base64Data = dataUrl.substring(base64Index + base64Marker.length);

	// Validate content type
	if (!contentType.startsWith('image/')) {
		throw new Error(`Invalid content type: ${contentType}. Must be an image type.`);
	}

	// Check size before creating buffer (base64 is ~33% larger than binary)
	const estimatedSize = (base64Data.length * 3) / 4;
	const maxSize = 5 * 1024 * 1024; // 5MB

	if (estimatedSize > maxSize) {
		throw new Error(`Image too large. Maximum size is 5MB, got ${(estimatedSize / 1024 / 1024).toFixed(2)}MB`);
	}

	try {
		const buffer = Buffer.from(base64Data, 'base64');
		return { buffer, contentType };
	} catch (error) {
		throw new Error('Failed to decode base64 image data');
	}
}
