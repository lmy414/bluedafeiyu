import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  // The admin app is built in GitHub Actions and deployed as a self-contained
  // Next.js output. Keep native/runtime packages external so output tracing
  // copies them into .next/standalone instead of webpack bundling them.
  output: 'standalone',
  outputFileTracingRoot: dirname,
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/@img/**/*',
      './node_modules/@libsql/**/*',
      './node_modules/libsql/**/*',
      './node_modules/sharp/**/*',
    ],
  },
  serverExternalPackages: [
    '@libsql/client',
    '@payloadcms/db-sqlite',
    '@payloadcms/drizzle',
    'libsql',
    'payload',
    'sharp',
  ],
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
