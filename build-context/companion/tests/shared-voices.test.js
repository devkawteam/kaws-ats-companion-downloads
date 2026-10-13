const test=require('node:test'); const assert=require('node:assert/strict');
const {createSpeech}=require('../../relay-server/jarvisSpeech');
test('shared Kokoro uses protected speech-only routes, omits driver identity, returns WAV and enforces quota',async()=>{
 const seen=[];
 const env={JARVIS_TTS:'kokoro',JARVIS_OLLAMA_URL:'https://protected.example',JARVIS_CF_CLIENT_ID:'id',JARVIS_CF_CLIENT_SECRET:'secret',JARVIS_TTS_DRIVER_CHARS_HOUR:'10'};
 const voice={id:'en-GB-Kokoro-bm_george',name:'George',lang:'en-GB',accent:'British',gender:'male'};
 const sp=createSpeech({env,fetchImpl:async(url,opts)=>{seen.push({url,opts}); return url.endsWith('/voices')?new Response(JSON.stringify({voices:[voice]}),{headers:{'content-type':'application/json'}}):new Response('RIFFsample',{headers:{'content-type':'audio/wav'}});}});
 const call=(text)=>new Promise(resolve=>sp.handle({method:'POST',headers:{},socket:{remoteAddress:'1'}},{writeHead(s,h){this.s=s;this.h=h},end(b){resolve({status:this.s,type:this.h['content-type'],b})}},new URL('http://relay/api/jarvis/speak'),{readJson:async()=>({installId:'driver-12345',driverName:'Private name',voice:voice.id,text}),sendJson:(_,status,json)=>resolve({status,json})}));
 assert.equal((await call('Hello')).type,'audio/wav');
 assert.equal(seen[1].url,'https://protected.example/api/voice/speak');
 assert.equal(seen[1].opts.headers['CF-Access-Client-Secret'],'secret');
 assert.deepEqual(Object.keys(JSON.parse(seen[1].opts.body)).sort(),['rate','text','voice']);
 assert.equal((await call('Second phrase')).status,429);
});
