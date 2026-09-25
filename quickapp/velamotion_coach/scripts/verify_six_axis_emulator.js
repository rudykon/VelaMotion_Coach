#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const { spawnSync } = require('child_process');
const proto = path.resolve(__dirname, '../node_modules/@aiot-toolkit/emulator/lib/static/proto/emulator_controller.proto');
const def = loader.loadSync(proto, { keepCase: true, enums: String, defaults: true });
const Controller = grpc.loadPackageDefinition(def).android.emulation.control.EmulatorController;
const client = new Controller('127.0.0.1:8554', grpc.credentials.createInsecure());
const call = (method, data) => new Promise((resolve,reject) => client[method](data,(error,result)=>error?reject(error):resolve(result)));
const wait = (ms) => new Promise(resolve => setTimeout(resolve,ms));
async function tap(x,y) { await call('sendMouse',{x,y,buttons:0,display:0}); await wait(45); await call('sendMouse',{x,y,buttons:1,display:0}); await wait(110); await call('sendMouse',{x,y,buttons:0,display:0}); await wait(150); }
async function main() {
  const [action,...args]=process.argv.slice(2);
  if(action==='shot') {
    const response=await call('getScreenshot',{format:'PNG',width:432,height:514,display:0});
    fs.writeFileSync(args[0] || '/tmp/velamotion-six-axis.png',response.image);
    console.log(JSON.stringify({width:response.width,height:response.height,path:args[0]}));
  } else if(action==='tap') { await tap(Number(args[0]),Number(args[1])); }
  else if(action==='swipe') {
    const [x,y,endX,endY]=args.map(Number);
    await call('sendMouse',{x,y,buttons:1,display:0});
    for(let i=1;i<=12;i++) { await call('sendMouse',{x:Math.round(x+(endX-x)*i/12),y:Math.round(y+(endY-y)*i/12),buttons:1,display:0}); await wait(30); }
    await call('sendMouse',{x:endX,y:endY,buttons:0,display:0});
  } else if(action==='inject') {
    const duration=Number(args[0] || 12000); const started=Date.now(); let count=0;
    while(Date.now()-started<duration) {
      const t=(Date.now()-started)/1000;
      // A known varying input makes a zero-filled or app-internal Mock path detectable.
      const a=[1.25+Math.sin(t*6),-2.5+Math.cos(t*6),9.75];
      const g=[.5+Math.sin(t*6)*.2,-.75,1.25];
      await call('setSensor',{target:'ACCELERATION',value:{data:a}});
      await call('setSensor',{target:'GYROSCOPE',value:{data:g}});
      count++; await wait(10);
    }
    console.log(JSON.stringify({injectedFrames:count,durationMs:Date.now()-started}));
  } else if(action==='logs') {
    const output=spawnSync('adb',['-s','emulator-5554','shell','dmesg'],{encoding:'utf8',maxBuffer:16*1024*1024}).stdout || '';
    console.log(output.split('\n').filter(line=>/VMC_(SIX_AXIS|REAL_SENSOR|SESSION_|LIVE)/.test(line)).slice(-45).join('\n'));
  } else throw new Error('Use shot <png>, tap x y, swipe x y x2 y2, inject [ms], or logs');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>client.close());
