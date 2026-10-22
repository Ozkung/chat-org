import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

/*
 * Google sign-in, with users and accounts stored through Prisma.
 * Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
 *
 * AUTH_DEV_LOGIN=1 adds a name-only login for local development and automated tests.
 * It is ignored on Vercel so it can never be switched on in a deployment.
 */
export const devLoginEnabled = process.env.AUTH_DEV_LOGIN === '1' && !process.env.VERCEL;

const providers = [Google];

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: 'dev',
      name: 'Dev login',
      credentials: { name: { label: 'Name', type: 'text' } },
      async authorize(credentials) {
        const name = String(credentials?.name || '').trim().slice(0, 40);
        if (!name) return null;
        const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@dev.local`;
        return prisma.user.upsert({ where: { email }, update: { name }, create: { email, name } });
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers,
  // JWT sessions: no database lookup per request (and required for the dev login above).
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: { signIn: '/signin' },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.uid ?? token.sub;
      return session;
    },
  },
});
