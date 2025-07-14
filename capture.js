const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const lines = fs.readFileSync('urls.txt', 'utf-8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0);

const outputDir = 'output';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath()
  });

  for (const line of lines) {
    const [url, rawName] = line.split('|');
    const name = rawName.trim().replace(/[\\/:*?"<>|]/g, '_');
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)');
    await page.setViewport({ width: 390, height: 844 });

    console.log(`🌐 ${name} 캡처 시작`);

    await page.goto(url.trim(), { waitUntil: 'networkidle2', timeout: 0 });

    // 고정 요소 및 팝업 숨기기 (이벤트 알림 포함)
    await page.evaluate(() => {
      const hideSelectors = [
        'div.qbanner',
        'div[style*="position: fixed"]',
        'header',
        'footer',
        '.floatingMenu',
        '.app_down_btn_box',
        'div[class*="popup"]',
        'div[class*="event"]',
        'div[class*="alert"]',
        'div[class*="modal"]',
        'div[class*="notification"]',
        'div[class*="promotionBanner"]',
        'div[class*="shop_alert"]',
        'div[class*="toast"]',
        'div[class*="inAppPush"]',
        'div[class*="push"]',
        'div[class*="banner"]',
        'div[class*="subscribe"]',
        'div[class*="permission"]'
      ];
      hideSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          el.style.display = 'none';
        });
      });
    });

    const scrollDelay = 1500;
    let previousHeight;
    while (true) {
      previousHeight = await page.evaluate('document.body.scrollHeight');
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, scrollDelay));
      const currentHeight = await page.evaluate('document.body.scrollHeight');
      if (currentHeight === previousHeight) break;
    }

    const screenshots = [];
    let index = 0;
    let offset = 0;
    const viewportHeight = 844;

    while (offset < await page.evaluate('document.body.scrollHeight')) {
      await page.evaluate(y => window.scrollTo(0, y), offset);
      await new Promise(resolve => setTimeout(resolve, 800));
      const filepath = path.join(outputDir, `${name}_temp_${index}.png`);
      await page.screenshot({ path: filepath });
      screenshots.push(filepath);
      offset += viewportHeight;
      index++;
    }

    const imageBuffers = await Promise.all(
      screenshots.map(f => fs.promises.readFile(f))
    );
    const sharpImages = imageBuffers.map(img => sharp(img));
    const meta = await Promise.all(sharpImages.map(img => img.metadata()));

    const totalHeight = meta.reduce((sum, m) => sum + m.height, 0);
    const width = meta[0].width;

    let y = 0;
    const parts = await Promise.all(sharpImages.map(async (img, i) => {
      const buffer = await img.toBuffer();
      const input = { input: buffer, top: y, left: 0 };
      y += meta[i].height;
      return input;
    }));

    const finalImage = sharp({
      create: {
        width,
        height: totalHeight,
        channels: 4,
        background: '#ffffff'
      }
    }).composite(parts);

    const outputPath = path.join(outputDir, `${name}_최종.png`);
    await finalImage.png().toFile(outputPath);
    console.log(`✅ ${name} 캡처 완료 → ${outputPath}`);

    screenshots.forEach(f => fs.unlinkSync(f));
    await page.close();
  }

  await browser.close();
  console.log('🎉 모든 작업 완료!');
})();
