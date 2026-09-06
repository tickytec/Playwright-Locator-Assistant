// Renders store/icon.svg to the PNG sizes the manifest and the Web Store need.
// `npm run icons`
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVG = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
// Below 48px the arcs and inner lines blur; a reduced mark keeps the silhouette.
const SVG_SMALL = fs.readFileSync(path.join(__dirname, 'icon-small.svg'), 'utf8');
const TARGETS = [
    [16, 'icons/icon16.png'],
    [32, 'icons/icon32.png'],
    [48, 'icons/icon48.png'],
    [128, 'icons/icon128.png'],
    [128, 'store/icon-128.png'],
    [512, 'store/icon-512.png'],
];

(async () => {
    const browser = await chromium.launch();
    for (const [size, rel] of TARGETS) {
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        const svg = (size < 48 ? SVG_SMALL : SVG).replace('width="128" height="128"', `width="${size}" height="${size}"`);
        await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
        await page.screenshot({ path: path.join(ROOT, rel), omitBackground: true, type: 'png' });
        await page.close();
        console.log('wrote', rel);
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
