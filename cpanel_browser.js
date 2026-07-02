const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1024 });

  try {
    console.log("Navigating to cPanel login...");
    await page.goto('https://s3692.usc1.stableserver.net:2083/', { waitUntil: 'networkidle2' });

    console.log("Typing credentials...");
    await page.type('#user', 'sainpricingpp');
    await page.type('#pass', 'MG9TX%is3p5*cYS');
    
    console.log("Clicking login...");
    await Promise.all([
      page.click('#login_submit'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    console.log("Logged in successfully. Searching for Node.js app...");
    
    // Search
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const target = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('search'));
      if (target) {
        target.focus();
        target.value = 'Node';
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 3000));

    // Click link
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const target = links.find(l => l.innerText && l.innerText.toLowerCase().includes('node'));
      if (target) {
        target.click();
      }
    });

    console.log("Waiting for navigation to Node Selector...");
    await new Promise(r => setTimeout(r, 12000));

    const screenshotDir = 'C:/Users/jibra/.gemini/antigravity/brain/9e8799f2-ce2b-4603-b94a-f7b59e3aca3a';
    await page.screenshot({ path: path.join(screenshotDir, 'cpanel_node_selector.png') });

    // Click Edit button natively using coordinates
    console.log("Waiting for app list rows to load...");
    let editCoords = null;
    for (let i = 0; i < 20; i++) {
      editCoords = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const targetRow = rows.find(r => r.innerText && r.innerText.includes('sainpricing.pp.ua'));
        if (targetRow) {
          const editBtn = targetRow.querySelector('.lvemanager-icon-edit');
          if (editBtn) {
            const r = editBtn.getBoundingClientRect();
            return { x: r.left + r.width/2, y: r.top + r.height/2 };
          }
        }
        return null;
      });
      if (editCoords) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log("Edit coords loaded:", editCoords);

    if (editCoords) {
      await page.mouse.click(editCoords.x, editCoords.y);
      console.log("Clicked edit button natively!");
    } else {
      throw new Error("Could not find edit button coordinates");
    }

    // Wait for Edit Mode details to finish loading (wait for Run NPM Install button to exist)
    console.log("Waiting for Run NPM Install button to appear...");
    let npmBtnFound = false;
    let npmCoords = null;
    for (let i = 0; i < 20; i++) {
      npmCoords = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Run NPM Install'));
        if (btn) {
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        }
        return null;
      });
      if (npmCoords) {
        npmBtnFound = true;
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log("Run NPM Install button loaded:", npmBtnFound, "Coords:", npmCoords);
    await page.screenshot({ path: path.join(screenshotDir, 'cpanel_edit_mode.png') });

    if (npmBtnFound && npmCoords) {
      // Click the Run NPM Install button natively
      console.log("Clicking Run NPM Install button natively...");
      await page.mouse.click(npmCoords.x, npmCoords.y);
      
      // Wait for NPM Install text to disappear (up to 120 seconds)
      console.log("Waiting for NPM Install to finish on server...");
      let npmFinished = false;
      for (let i = 0; i < 60; i++) {
        const isInstalling = await page.evaluate(() => {
          return document.body.innerText.includes('Installing NPM...');
        });
        if (!isInstalling) {
          npmFinished = true;
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log("NPM install finished:", npmFinished);
      await page.screenshot({ path: path.join(screenshotDir, 'cpanel_after_npm.png') });
    }

    // Find and click STOP APP natively
    console.log("Finding STOP APP button...");
    const stopCoords = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('STOP APP'));
      if (btn) {
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width/2, y: r.top + r.height/2 };
      }
      return null;
    });
    if (stopCoords) {
      console.log("Stopping application...");
      await page.mouse.click(stopCoords.x, stopCoords.y);
      await new Promise(r => setTimeout(r, 6000));
    }

    // Find and click START APP natively
    console.log("Finding START APP button...");
    const startCoords = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('START APP'));
      if (btn) {
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width/2, y: r.top + r.height/2 };
      }
      return null;
    });
    if (startCoords) {
      console.log("Starting application...");
      await page.mouse.click(startCoords.x, startCoords.y);
      await new Promise(r => setTimeout(r, 10000));
    }

    await page.screenshot({ path: path.join(screenshotDir, 'cpanel_after_restart.png') });
    console.log("Restart completed successfully.");

  } catch (err) {
    console.error("Browser error:", err);
  } finally {
    await browser.close();
  }
}

run();
