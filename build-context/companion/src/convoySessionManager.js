const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
class ConvoySessionManager{
 constructor(driverName,dataDir=path.join(process.cwd(),'data')){this.driverName=driverName||'Driver';this.file=path.join(dataDir,'convoy-sessions.json');this.sessions=[];this.activeId=null;this.load()}
 load(){try{fs.mkdirSync(path.dirname(this.file),{recursive:true});if(fs.existsSync(this.file)){const x=JSON.parse(fs.readFileSync(this.file,'utf8'));this.sessions=x.sessions||[];this.activeId=x.activeId||null}}catch(e){console.error('[SESSION] Load failed:',e.message)}}
 save(){fs.writeFileSync(this.file,JSON.stringify({activeId:this.activeId,sessions:this.sessions},null,2))}
 create(input={}){const s={id:`session_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,name:String(input.name||'KAW Convoy'),host:String(input.host||this.driverName),meetPoint:String(input.meetPoint||''),destination:String(input.destination||''),departureTime:input.departureTime||null,notes:String(input.notes||''),status:'planned',createdAt:new Date().toISOString(),startedAt:null,endedAt:null,checkpoints:[],participants:[],rosterSnapshots:[]};this.sessions.unshift(s);this.save();return s}
 list(limit=50){return this.sessions.slice(0,Math.max(1,Number(limit)||50))}get(id){return this.sessions.find(s=>s.id===id)||null}getActive(){return this.activeId?this.get(this.activeId):null}
 start(id,roster=[]){const s=this.get(id);if(!s)return null;this.activeId=id;s.status='active';s.startedAt||=new Date().toISOString();this.snapshot(roster);this.save();return s}
 end(id,roster=[]){const s=this.get(id);if(!s)return null;this.snapshot(roster);s.status='completed';s.endedAt=new Date().toISOString();if(this.activeId===id)this.activeId=null;this.save();return s}
 addCheckpoint(id,input={}){const s=this.get(id);if(!s)return null;const c={id:`checkpoint_${Date.now()}`,name:String(input.name||`Checkpoint ${s.checkpoints.length+1}`),location:String(input.location||''),notes:String(input.notes||''),status:'planned',createdAt:new Date().toISOString(),completedAt:null};s.checkpoints.push(c);this.save();return c}
 completeCheckpoint(id,checkpointId){const s=this.get(id),c=s?.checkpoints.find(x=>x.id===checkpointId);if(!c)return null;c.status='completed';c.completedAt=new Date().toISOString();this.save();return c}
 snapshot(roster=[]){const s=this.getActive();if(!s)return null;const snap={at:new Date().toISOString(),participants:(roster||[]).map(p=>({id:p.id,driverName:p.driverName,online:Boolean(p.online),relation:p.relation||'',modFingerprint:p.capabilities?.modFingerprint||null}))};s.participants=snap.participants;s.rosterSnapshots.push(snap);s.rosterSnapshots=s.rosterSnapshots.slice(-100);this.save();return snap}
 summary(){return{active:this.getActive(),recent:this.list(20)}}
}
module.exports={ConvoySessionManager};
