import page from 'project:page';
import template from 'project:template';
import { setNativeModelBackend } from '../../quickapp/velamotion_coach/src/common/algorithm/model_backend.js';
import { mountPage } from './renderer.js';
import { createWasmBackend } from './wasm-backend.js';

const $ = id => document.getElementById(id);
const names = ['首页','初筛','时间线','同步复盘'];
let app, calls=0, lastMs=0, engine, ready=false, exited=false, hiddenStop=false;
const sourceText = '源自项目 UX 页面 · 浏览器兼容预览';
function setStatus(text) { $('preview-status').textContent=text; }
function update(vm) {
  $('current-page').textContent=names[vm.pageState.index];
  $('preview-stage').textContent=vm.isFinalizing ? '正在整理训练' : vm.isRunning ? '训练中 · 合成六轴输入' : '可以开始训练';
  $('preview-scene').textContent=vm.currentSceneName;
  $('preview-calls').textContent=String(calls);
  $('preview-time').textContent=calls ? `${lastMs.toFixed(3)} ms` : '等待训练';
  $('preview-elapsed').textContent=vm.live.elapsedText;
  for (const button of document.querySelectorAll('[data-page]')) button.setAttribute('aria-current', Number(button.dataset.page)===vm.pageState.index ? 'page' : 'false');
}
function exit() {
  exited=true; app.hide(); $('preview-exit').hidden=false;
  setStatus('已返回预览入口，点击继续可回到应用');
}
async function start() {
  const [cssResponse, wasmResponse, infoResponse] = await Promise.all([
    fetch('./page.css'), fetch('../wasm/classifier.wasm'), fetch('./source-info.json'),
  ]);
  if (![cssResponse,wasmResponse,infoResponse].every(r=>r.ok)) throw new Error('预览资源加载失败，请刷新重试。');
  const [{instance}, css, info] = await Promise.all([
    WebAssembly.instantiate(await wasmResponse.arrayBuffer(), {env:{abort(){throw new Error('WASM 计算异常');}}}),
    cssResponse.text(), infoResponse.json(),
  ]);
  engine=instance.exports;
  setNativeModelBackend(createWasmBackend(engine, ms => {lastMs=ms; calls++;}));
  app=mountPage($('quickapp'),page,template,css,update,exit);
  ready=true; setStatus(sourceText);
  $('source-hash').textContent=info.uxSha256.slice(0,12);
  $('loading').hidden=true;
  document.querySelectorAll('[data-page],#preview-back').forEach(button=>{button.disabled=false;});
}
for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click',()=>app?.vm.setDemoPage(Number(button.dataset.page)));
$('preview-back').addEventListener('click',()=>app?.vm.previousDemoPage());
$('preview-resume').addEventListener('click',()=>{exited=false; $('preview-exit').hidden=true; app.show(); setStatus(sourceText);});
$('preview-retry').addEventListener('click',()=>location.reload());
// Browser background timers are throttled. Finalize through the original app
// stop path instead of silently treating missing time as a valid workout.
document.addEventListener('visibilitychange',()=>{
  if (!ready) return;
  if (document.hidden) {
    if (app.vm.isRunning) { app.vm.stopSession(); hiddenStop=true; }
    app.hide();
  } else if (!exited) {
    app.show(); if (hiddenStop) {setStatus('离开页面时已结束训练，结果可在历史中查看');hiddenStop=false;}
  }
});
window.addEventListener('pagehide',()=>app?.destroy(),{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
const resize=()=>{
  const width=Math.min(390,$('watch-holder').clientWidth);
  $('watch-sizer').style.width=`${width}px`; $('watch-sizer').style.height=`${width*554/480}px`;
  $('quickapp').style.transform=`scale(${width/480})`;
};
new ResizeObserver(resize).observe($('watch-holder')); resize();
start().catch(error=>{
  $('loading').hidden=true; $('preview-error').hidden=false;
  $('preview-error-text').textContent=error.message; setStatus('预览未启动');
});

// Resize an embedded preview only on its own origin; no remote endpoint exists.
if (window.parent !== window) {
  const notifySize = () => parent.postMessage({ type:'velamotion-preview-size', height:Math.ceil(document.body.scrollHeight) }, location.origin);
  new ResizeObserver(notifySize).observe(document.body);
  window.addEventListener('load',notifySize);
}
