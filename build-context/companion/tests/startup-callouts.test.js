'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function legacyCallouts(telemetry) {
  const html = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const spoken = [];
  const context = {window:{},document:{readyState:'complete'}, prefs:{navVoice:true,navVoiceFrequency:'critical',navOverspeed:0}, navLastMilestone:null,navLastOverspeed:0,navLastCritical:{}, $:()=>({}), compassHeading:()=>'',fmtEta:()=>'',f0:Math.round, f1:String, speakText:text=>spoken.push(text)};
  vm.createContext(context);
  vm.runInContext(html.match(/^const finite=.*$/m)[0] + '\n' + html.match(/^function renderNavCopilot\(d\).*$/m)[0], context);
  context.renderNavCopilot(telemetry);
  return spoken;
}

test('opening the dashboard offline cannot announce missing fuel, speed, rest or damage', () => {
  assert.deepEqual(legacyCallouts({connected:false,truck:{fuelRangeMiles:null},navigation:{restStopMinutes:null},damage:{enginePercent:99}}),[]);
});

test('connected missing fuel does not warn, but a real low range does', () => {
  for (const fuelRangeMiles of [null,undefined,'',-1]) assert.deepEqual(legacyCallouts({connected:true,truck:{fuelRangeMiles},navigation:{}}),[]);
  assert.deepEqual(legacyCallouts({connected:true,truck:{fuelRangeMiles:20},navigation:{}}),['Fuel warning. Your estimated fuel range is under 30 miles.']);
  assert.deepEqual(legacyCallouts({connected:true,sdk:{paused:true},truck:{fuelRangeMiles:20},navigation:{}}),[]);
});
