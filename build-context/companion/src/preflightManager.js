const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function nowIso(){ return new Date().toISOString(); }
function uid(prefix='manifest'){ return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`; }
function norm(v){ return String(v || '').trim().toLowerCase(); }
function uniq(arr){ return [...new Set((arr || []).filter(Boolean))]; }

class PreflightManager {
  constructor(dataDir = path.join(process.cwd(), 'data')) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'convoy-manifests.json');
    this.manifests = [];
    this.activeId = null;
    this.load();
  }

  load(){
    try{
      fs.mkdirSync(this.dataDir,{recursive:true});
      if(!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file,'utf8'));
      this.manifests = Array.isArray(parsed.manifests) ? parsed.manifests : [];
      this.activeId = parsed.activeId || null;
    }catch(e){
      console.error('[PREFLIGHT] Load failed:',e.message);
      this.manifests=[]; this.activeId=null;
    }
  }

  save(){
    fs.mkdirSync(this.dataDir,{recursive:true});
    fs.writeFileSync(this.file,JSON.stringify({activeId:this.activeId,manifests:this.manifests},null,2),'utf8');
  }

  normalizeMod(m={},index=0){
    return {
      id: m.id || uid('mod'),
      order: Number(m.order || index+1),
      name: String(m.name || '').trim(),
      workshopId: (String(m.workshopId || '').match(/(\d{6,})/) || [])[1] || String(m.workshopId || '').trim(),
      version: String(m.version || '').trim(),
      required: m.required !== false,
      source: String(m.source || (m.workshopId ? 'workshop' : 'local')).trim().toLowerCase(),
      notes: String(m.notes || '').trim(),
      // Steam 'last updated' when the pack was saved, so drivers can see if a mod changed since.
      workshopUpdatedAt: m.workshopUpdatedAt && !Number.isNaN(Date.parse(m.workshopUpdatedAt)) ? new Date(m.workshopUpdatedAt).toISOString() : null,
      sizeBytes: Number.isFinite(Number(m.sizeBytes)) ? Number(m.sizeBytes) : null,
      url: /^https:\/\/[^\s"'<>]+$/i.test(String(m.url || '').trim()) ? String(m.url).trim() : ''
    };
  }

  create(input={}){
    const manifest={
      id:uid(),
      name:String(input.name || `Convoy ${new Date().toLocaleDateString()}`).trim(),
      game:String(input.game || 'ATS').toUpperCase(),
      gameVersion:String(input.gameVersion || '').trim(),
      requiredDlcTokens:uniq((input.requiredDlcTokens || []).map(norm)),
      requiredMapStates:uniq((input.requiredMapStates || []).map(String)),
      mods:Array.isArray(input.mods)?input.mods.map((m,i)=>this.normalizeMod(m,i)):[],
      notes:String(input.notes || '').trim(),
      createdAt:nowIso(),
      updatedAt:nowIso()
    };
    this.manifests.unshift(manifest);
    this.activeId=manifest.id;
    this.save();
    return manifest;
  }

  list(){ return this.manifests; }
  get(id){ return this.manifests.find(x=>x.id===id) || null; }
  getActive(){ return this.activeId ? this.get(this.activeId) : null; }

  setActive(id){
    if(!this.get(id)) return null;
    this.activeId=id; this.save(); return this.get(id);
  }

  update(id,patch={}){
    const m=this.get(id); if(!m) return null;
    if(patch.name!==undefined)m.name=String(patch.name);
    if(patch.game!==undefined)m.game=String(patch.game).toUpperCase();
    if(patch.gameVersion!==undefined)m.gameVersion=String(patch.gameVersion);
    if(patch.notes!==undefined)m.notes=String(patch.notes);
    if(Array.isArray(patch.requiredDlcTokens))m.requiredDlcTokens=uniq(patch.requiredDlcTokens.map(norm));
    if(Array.isArray(patch.requiredMapStates))m.requiredMapStates=uniq(patch.requiredMapStates.map(String));
    if(Array.isArray(patch.mods))m.mods=patch.mods.map((x,i)=>this.normalizeMod(x,i));
    m.updatedAt=nowIso(); this.save(); return m;
  }

  remove(id){
    const before=this.manifests.length;
    this.manifests=this.manifests.filter(x=>x.id!==id);
    if(this.activeId===id)this.activeId=this.manifests[0]?.id || null;
    if(this.manifests.length===before)return false;
    this.save(); return true;
  }

  compareCapabilities(caps={},manifest=this.getActive()){
    if(!manifest)return {status:'NO MANIFEST',score:0,checks:[],missingMods:[],extraMods:[],orderIssues:[]};
    const installedDlc=new Set((caps.dlcTokens || []).map(norm));
    const installedWorkshop=new Set((caps.workshopIds || []).map(norm));
    const installedLocal=(caps.localModNames || []).map(norm);
    const activeRefs=(caps.activeModRefs || []).map(norm);
    const checks=[];

    const gameVersionOk=!manifest.gameVersion || !caps.gameVersion || norm(manifest.gameVersion)===norm(caps.gameVersion);
    checks.push({key:'gameVersion',label:'Game Version',ok:gameVersionOk,expected:manifest.gameVersion || 'Any',actual:caps.gameVersion || 'Unknown'});

    const missingDlc=manifest.requiredDlcTokens.filter(x=>!installedDlc.has(norm(x)));
    checks.push({key:'dlc',label:'Required DLC',ok:missingDlc.length===0,missing:missingDlc});

    const missingMods=[];
    const orderIssues=[];
    const required=manifest.mods.filter(x=>x.required);
    for(const mod of required){
      let present=false;
      if(mod.workshopId) present=installedWorkshop.has(norm(mod.workshopId)) || activeRefs.some(r=>r.includes(norm(mod.workshopId)));
      if(!present && mod.name) present=installedLocal.some(n=>n===norm(mod.name) || n.includes(norm(mod.name))) || activeRefs.some(r=>r.includes(norm(mod.name)));
      if(!present)missingMods.push(mod);
    }
    checks.push({key:'mods',label:'Required Mods',ok:missingMods.length===0,missing:missingMods.map(x=>x.name || x.workshopId)});

    const expectedOrdered=manifest.mods.filter(x=>x.required).sort((a,b)=>a.order-b.order);
    if(activeRefs.length && expectedOrdered.length){
      let lastIndex=-1;
      for(const mod of expectedOrdered){
        const needles=[norm(mod.workshopId),norm(mod.name)].filter(Boolean);
        const idx=activeRefs.findIndex((r,i)=>i>lastIndex && needles.some(n=>r.includes(n)));
        if(idx>=0) lastIndex=idx;
        else if(!missingMods.some(x=>x.id===mod.id)) orderIssues.push(mod.name || mod.workshopId);
      }
    }
    checks.push({key:'order',label:'Load Order',ok:orderIssues.length===0,issues:orderIssues});

    const expectedIds=new Set(manifest.mods.map(x=>norm(x.workshopId)).filter(Boolean));
    const expectedNames=manifest.mods.map(x=>norm(x.name)).filter(Boolean);
    const extraMods=[];
    for(const id of installedWorkshop){ if(expectedIds.size && !expectedIds.has(id)) extraMods.push({type:'workshop',value:id}); }
    for(const name of installedLocal){ if(expectedNames.length && !expectedNames.some(n=>name===n || name.includes(n))) extraMods.push({type:'local',value:name}); }

    const failed=checks.filter(x=>!x.ok).length;
    const score=Math.max(0,100-(failed*25)-Math.min(25,missingMods.length*5)-Math.min(15,orderIssues.length*3));
    const status=failed===0 ? 'READY' : (gameVersionOk && missingDlc.length===0 && missingMods.length===0 ? 'REVIEW' : 'NOT READY');
    return {status,score,checks,missingDlc,missingMods,extraMods,orderIssues,manifestId:manifest.id};
  }

  evaluateRoster(roster=[],localScan={}){
    const manifest=this.getActive();
    const drivers=(roster || []).map(driver=>({
      id:driver.id,
      driverName:driver.driverName,
      isLocal:Boolean(driver.isLocal),
      online:Boolean(driver.online),
      result:this.compareCapabilities(driver.isLocal ? (localScan.capabilities || {}) : (driver.capabilities || {}),manifest)
    }));
    const online=drivers.filter(d=>d.online);
    return {
      generatedAt:nowIso(),
      manifest,
      overall:!manifest?'NO MANIFEST':online.every(d=>d.result.status==='READY')?'READY':online.some(d=>d.result.status==='NOT READY')?'NOT READY':'REVIEW',
      readyCount:online.filter(d=>d.result.status==='READY').length,
      onlineCount:online.length,
      drivers
    };
  }
}

module.exports={PreflightManager};
