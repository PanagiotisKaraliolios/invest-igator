import type { IconType } from 'react-icons';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { FcGoogle } from 'react-icons/fc';
import { MdEmail } from 'react-icons/md';

export const providerLabel: Record<string, string> = {
	credentials: 'Password',
	discord: 'Discord',
	email: 'Email',
	github: 'GitHub',
	google: 'Google'
};

export const providerIcons: Record<string, IconType> = {
	discord: FaDiscord,
	email: MdEmail,
	github: FaGithub,
	google: FcGoogle
};
