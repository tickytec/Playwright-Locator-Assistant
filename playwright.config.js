// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: true,
    reporter: process.env.CI ? 'github' : 'list',
    timeout: 30_000,
    use: {
        browserName: 'chromium',
        headless: true,
    },
});
