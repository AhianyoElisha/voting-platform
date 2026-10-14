// Sentry v11 ships its build wrapper from the /config subpath.
import { withSentryConfig } from '@sentry/nextjs/config'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Native server-side packages: loaded at runtime, never bundled by webpack.
  serverExternalPackages: ['@napi-rs/canvas', 'sharp'],
  images: {
    minimumCacheTTL: 2678400 * 6, // 3 months
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fra.cloud.appwrite.io',
        port: '',
        pathname: '/**',
      },
    ],
  },
}

// Sentry wiring copied from pickLT. Inert until NEXT_PUBLIC_SENTRY_DSN is set;
// source maps upload only when SENTRY_AUTH_TOKEN is set on the host (never in
// the repo). Browser reports tunnel through /monitoring on our own domain.
// Org and project come from the host's env; the app runs on Vercel (decision #24).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT || 'voteapp-web',
  sentryUrl: process.env.SENTRY_URL,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
})
