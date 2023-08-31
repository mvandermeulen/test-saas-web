import { fail, redirect, type Actions } from '@sveltejs/kit';

import { auth } from '$lib/server/lucia';
import { prisma } from '$lib/server/prisma';

import { LuciaError } from 'lucia-auth';

import { sendEmail } from '$lib/server/emailjs';

import { PUBLIC_APP_NAME, PUBLIC_APP_URL } from '$env/static/public';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.validate();

	if (!session) {
		throw redirect(302, '/login');
	}

	return {
		user: await auth.getUser(session.userId)
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const { email } = Object.fromEntries(await request.formData()) as Record<string, string>;

		try {
			const { user } = await auth.getKeyUser('email', email);

			if (!user) {
				return fail(400, {
					formData: { email },
					error: true,
					errors: [
						{
							field: 'email',
							message: 'We could not find an account with that email'
						}
					]
				});
			}

			const user_id = user.userId;
			// Check if a resetToken already exists for this user
			let verifyToken = await prisma.emailVerifyToken.findFirst({
				where: { user_id }
			});

			if (!verifyToken) {
				verifyToken = await prisma.emailVerifyToken.create({
					data: {
						user_id
					}
				});
			} else if (verifyToken.expires < new Date()) {
				// Each token has an expiry date.
				// If the token is expired, delete it and make a new one
				await prisma.emailVerifyToken.delete({
					where: {
						id: verifyToken.id
					}
				});

				verifyToken = await prisma.emailVerifyToken.create({
					data: {
						user_id
					}
				});
			}

			// The page the user will be directed to from their email
			// We send the resetToken, and the user_id along
			const link = `${PUBLIC_APP_URL}/verify/${user_id}/${verifyToken.token}`;

			await sendEmail({
				subject: 'Verify your email',
				text: `Hi ${user.name},\n\nPlease verify your email by clicking the link below:\n\n${link}\n\nThanks,\n\nThe ${PUBLIC_APP_NAME} team`,
				to: user.email
			});

			return {
				type: 'success',
				message: `We have sent an email to ${email}. Please follow the instructions in the email to verify your email address.`
			};
		} catch (err) {
			if (err instanceof LuciaError) {
				return fail(400, {
					formData: { email },
					error: true,
					errors: [
						{
							field: 'email',
							message: err.message
						}
					]
				});
			}

			return fail(500, {
				message: 'Internal server error'
			});
		}
	}
};
