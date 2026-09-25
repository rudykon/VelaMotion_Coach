import { test, expect } from '@playwright/test';
const appButton = (page, name) => page.locator('#quickapp').getByRole('button',{name,exact:true});
async function open(page) {
  await page.goto('./preview/');
  await expect(page.locator('#preview-status')).toContainText('源自项目 UX', {timeout:15000});
  await expect(appButton(page,'开始')).toBeVisible();
}
async function drag(page, locator, dx, dy=0) {
  const rect=await locator.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
  await page.mouse.down(); await page.mouse.move(rect.x+rect.width/2+dx,rect.y+rect.height/2+dy,{steps:10}); await page.mouse.up();
}

test('original UX runs training, WASM, stop, timeline, local advice and history without a server', async ({page}) => {
  const errors=[], requests=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('request',r=>requests.push(r.url()));
  await open(page);
  await appButton(page,'下一页').click(); await expect(page.locator('#current-page')).toHaveText('初筛');
  await appButton(page,'场景').click(); await appButton(page,'跑步').click();
  await page.locator('[data-page="0"]').click(); await appButton(page,'开始').click();
  await expect(page.locator('#preview-stage')).toContainText('训练中');
  await expect.poll(async()=>Number(await page.locator('#preview-calls').innerText()),{timeout:15000}).toBeGreaterThan(2);
  await expect(page.locator('#quickapp .activity-name')).toHaveText('跑步');
  await appButton(page,'下一页').click();
  await expect(page.locator('#quickapp .coach-prob-row')).toHaveCount(2);
  await appButton(page,'停止训练').click();
  await expect(page.locator('#preview-stage')).toHaveText('可以开始训练');
  const calls=await page.locator('#preview-calls').innerText();
  await page.locator('[data-page="2"]').click();
  await expect(page.locator('#quickapp .seg-row').first()).toBeVisible();
  await appButton(page,'复盘').click(); await appButton(page,'生成建议').click();
  await expect(page.locator('#quickapp .core-ai-review-text').first()).not.toBeEmpty();
  await page.locator('[data-page="3"]').click(); await appButton(page,'历史').click();
  await expect(page.locator('#quickapp .history-row')).toHaveCount(1);
  await expect(page.locator('#quickapp .history-title')).toHaveText('跑步节奏');
  await page.waitForTimeout(1300); expect(await page.locator('#preview-calls').innerText()).toBe(calls);
  expect(errors).toEqual([]);
  const origin=new URL(page.url()).origin; expect(requests.every(url=>new URL(url).origin===origin)).toBeTruthy();
  await page.reload(); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('[data-page="3"]').click(); await appButton(page,'历史').click();
  await expect(page.locator('#quickapp .history-row')).toHaveCount(0);
});

test('swipe cancels button action; keyboard, desktop return and page wrap remain usable', async ({page}) => {
  await open(page);
  await drag(page,appButton(page,'开始'),-95);
  await expect(page.locator('#current-page')).toHaveText('初筛');
  await expect(page.locator('#preview-stage')).toHaveText('可以开始训练');
  await expect(page.locator('#preview-calls')).toHaveText('0');
  await page.locator('[data-page="0"]').click();
  await appButton(page,'下一页').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#current-page')).toHaveText('初筛');
  await appButton(page,'桌面').click(); await expect(page.locator('#preview-exit')).toBeVisible();
  await page.getByRole('button',{name:'继续体验'}).click(); await expect(page.locator('#preview-exit')).toBeHidden();
  await page.locator('[data-page="0"]').click(); await page.locator('#preview-back').click();
  await expect(page.locator('#current-page')).toHaveText('同步复盘');
});

test('real-device mode reports unavailable sensors and performs no fake training', async ({page}) => {
  await open(page); await page.locator('[data-page="1"]').click();
  await appButton(page,'场景').click(); await appButton(page,'真机').click();
  await page.locator('[data-page="0"]').click(); await appButton(page,'开始').click();
  await expect(page.locator('#quickapp .activity-name')).toHaveText('ACC 不可用');
  await expect(page.locator('#preview-calls')).toHaveText('0');
  await expect(page.locator('#preview-stage')).toHaveText('可以开始训练');
});

test('WASM failure stops preview startup and exposes retry', async ({page}) => {
  await page.route('**/wasm/classifier.wasm',route=>route.abort());
  await page.goto('./preview/');
  await expect(page.locator('#preview-error')).toBeVisible();
  await expect(page.locator('#quickapp input')).toHaveCount(0);
  await page.unroute('**/wasm/classifier.wasm'); await page.locator('#preview-retry').click();
  await expect(appButton(page,'开始')).toBeVisible();
});

test('mobile preview scales original touch coordinates and stays within viewport', async ({page}) => {
  await page.setViewportSize({width:360,height:800}); await open(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await appButton(page,'下一页').click(); await expect(page.locator('#current-page')).toHaveText('初筛');
  await page.screenshot({path:'test-results/quickapp-mobile.png',fullPage:true});
});

test('home page opens the source preview only on request', async ({page}) => {
  await page.goto('./'); await expect(page.locator('#quickapp-frame')).toBeHidden();
  await page.getByRole('button',{name:'启动快应用预览'}).click();
  await expect(page.frameLocator('#quickapp-frame').locator('#preview-status')).toContainText('源自项目 UX');
});

test('leaving the browser tab finalizes training and keeps its history locally', async ({page}) => {
  await open(page); await appButton(page,'开始').click();
  await expect.poll(async()=>Number(await page.locator('#preview-calls').innerText()),{timeout:12000}).toBeGreaterThan(1);
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#preview-stage')).toHaveText('可以开始训练');
  const calls=await page.locator('#preview-calls').innerText();
  await page.waitForTimeout(1100);
  expect(await page.locator('#preview-calls').innerText()).toBe(calls);
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#preview-status')).toContainText('已结束训练');
  await page.locator('[data-page="3"]').click(); await appButton(page,'历史').click();
  await expect(page.locator('#quickapp .history-row')).toHaveCount(1);
});

test('phone touch events preserve tap and swipe behavior at scaled coordinates', async ({browser,baseURL}) => {
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  try {
    await open(page);
    await appButton(page,'下一页').tap(); await expect(page.locator('#current-page')).toHaveText('初筛');
    await page.locator('[data-page="0"]').tap();
    const rect=await appButton(page,'开始').boundingBox();
    const cdp=await context.newCDPSession(page);
    const x=rect.x+rect.width*.7,y=rect.y+rect.height*.5;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for (let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-i*12,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.locator('#current-page')).toHaveText('初筛');
    await expect(page.locator('#preview-calls')).toHaveText('0');
    await expect(page.locator('#preview-stage')).toHaveText('可以开始训练');
  } finally {await context.close();}
});
