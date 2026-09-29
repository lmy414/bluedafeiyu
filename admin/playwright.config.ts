import { defineConfig, devices } from '@playwright/test'

import 'dotenv/config'

const baseURL = process.env.S3_ADMIN_BASE_URL || 'http://127.0.0.1:3100'
const databaseURL = process.env.S3_ADMIN_DATABASE_URL || 'file:E:/quick-site-studio/tmp/s3-admin/admin.db'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /console\.e2e\.spec\.ts/,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3100',
    env: {
      ...process.env,
      ADMIN_PUBLISH_REQUEST_DIR: process.env.ADMIN_PUBLISH_REQUEST_DIR || 'E:/quick-site-studio/tmp/s3-admin/run',
      DATABASE_URL: databaseURL,
      MEDIA_DIR: process.env.MEDIA_DIR || 'E:/quick-site-studio/tmp/s3-admin/media',
      PAYLOAD_PUBLIC_SERVER_URL: baseURL,
      PAYLOAD_SECRET: process.env.PAYLOAD_SECRET || 's3-admin-local-secret',
      S3_ADMIN_OWNER_EMAIL: process.env.S3_ADMIN_OWNER_EMAIL || 'owner@local.test',
      S3_ADMIN_OWNER_PASSWORD: process.env.S3_ADMIN_OWNER_PASSWORD || '',
    },
    reuseExistingServer: true,
    timeout: 120_000,
    url: baseURL,
  },
})
