const fs = require('node:fs');
const path = require('node:path');

const ACHIEVEMENTS = [
  ['first_delivery','First Delivery',s=>s.deliveries>=1], ['road_regular','Road Regular',s=>s.deliveries>=10],
  ['century_club','Century Club',s=>s.totalMiles>=100], ['thousand_miler','Thousand Miler',s=>s.totalMiles>=1000],
  ['multi_stop_master','Multi-Stop Master',s=>s.multiStopRuns>=5], ['clean_machine','Clean Machine',s=>s.cleanDeliveries>=10],
  ['high_earner','High Earner',s=>s.totalIncome>=1000000],
  ['fifty_loads','Fifty Loads',s=>s.deliveries>=50], ['ten_thousand_miler','Ten Thousand Miler',s=>s.totalMiles>=10000],
  ['long_hauler','Long Hauler',s=>(s.records?.longestRunMiles||0)>=1000], ['spotless_25','Spotless 25',s=>s.cleanDeliveries>=25],
  ['millionaire_x5','Five Million Club',s=>s.totalIncome>=5000000],
  // Convoy achievements
  ['convoy_rookie','Convoy Rookie',s=>(s.convoys||0)>=1], ['convoy_regular','Convoy Regular',s=>(s.convoys||0)>=10],
  ['convoy_legend','Convoy Legend',s=>(s.convoys||0)>=50], ['perfect_formation','Perfect Formation',s=>(s.perfectFormations||0)>=1],
  ['convoy_long_haul','Convoy Long Haul',s=>(s.records?.longestConvoyMiles||0)>=500], ['big_convoy','Big Rig Parade',s=>(s.records?.biggestConvoy||0)>=8],
  // Challenges
  ['challenger','Challenger',s=>(s.challengesDone||0)>=1], ['challenge_streak','Daily Grinder',s=>(s.challengesDone||0)>=25]
];
class CareerManager {
  constructor(driverName, dataDir = path.join(process.cwd(),'data'), onUnlock = null) {
    this.file = path.join(dataDir,'career.json'); this.onUnlock = onUnlock;
    this.data = { driverName:driverName||'Driver', deliveries:0, totalMiles:0, totalIncome:0, cleanDeliveries:0, multiStopRuns:0, convoys:0, perfectFormations:0, challengesDone:0, bonusXp:0, bonuses:{}, records:{longestRunMiles:0,bestIncome:0,longestConvoyMiles:0,biggestConvoy:0}, achievements:[], updatedAt:null };
    this.load();
  }
  load(){try{fs.mkdirSync(path.dirname(this.file),{recursive:true});if(fs.existsSync(this.file)){const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));this.data={...this.data,...saved,records:{...this.data.records,...(saved.records||{})},bonuses:saved.bonuses||{}};}}catch(e){console.error('[CAREER] Load failed:',e.message)}}
  save(){this.data.updatedAt=new Date().toISOString();fs.writeFileSync(this.file,JSON.stringify(this.data,null,2))}
  checkAchievements(){const unlocked=[];for(const [id,name,test] of ACHIEVEMENTS){if(!this.data.achievements.some(a=>a.id===id)&&test(this.data)){const a={id,name,unlockedAt:new Date().toISOString()};this.data.achievements.push(a);unlocked.push(a);this.onUnlock?.(a)}}return unlocked}
  recordDispatch(dispatch){if(!dispatch?.id||dispatch.status!=='completed'||this.data.lastDispatchId===dispatch.id)return [];
    const stops=dispatch.stops||[], miles=stops.reduce((n,s)=>n+Number(s.actualMiles||s.plannedMiles||0),0), income=stops.reduce((n,s)=>n+Number(s.actualIncome||s.plannedIncome||0),0);
    this.data.lastDispatchId=dispatch.id;this.data.deliveries++;this.data.totalMiles+=miles;this.data.totalIncome+=income;if(stops.length>1)this.data.multiStopRuns++;
    const clean=stops.every(s=>Number(s.damagePercent||0)<=1);if(clean)this.data.cleanDeliveries++;
    this.data.records.longestRunMiles=Math.max(this.data.records.longestRunMiles||0,miles);this.data.records.bestIncome=Math.max(this.data.records.bestIncome||0,income);
    const unlocked=this.checkAchievements();this.save();return unlocked;
  }
  // A finished convoy event (from the fun manager).
  recordConvoy(c){if(!c?.id||(this.data.convoyIds||[]).includes(c.id))return [];
    this.data.convoyIds=[...(this.data.convoyIds||[]),c.id].slice(-300);this.data.convoys=(this.data.convoys||0)+1;if(c.perfect)this.data.perfectFormations=(this.data.perfectFormations||0)+1;
    this.data.records.longestConvoyMiles=Math.max(this.data.records.longestConvoyMiles||0,Number(c.miles)||0);this.data.records.biggestConvoy=Math.max(this.data.records.biggestConvoy||0,Number(c.drivers)||0);
    this.data.bonusXp=(this.data.bonusXp||0)+250+(c.perfect?250:0);
    const unlocked=this.checkAchievements();this.save();return unlocked;
  }
  // One-off XP (daily challenges). `key` prevents double awards.
  addBonus(key,xp,reason=''){if(!key||this.data.bonuses[key])return false;this.data.bonuses[key]={xp:Number(xp)||0,reason,at:new Date().toISOString()};this.data.bonusXp=(this.data.bonusXp||0)+(Number(xp)||0);if(String(key).includes(':'))this.data.challengesDone=(this.data.challengesDone||0)+1;this.checkAchievements();this.save();return true}
  get(){const xp=Math.floor(this.data.totalMiles)+this.data.deliveries*100+this.data.cleanDeliveries*50+this.data.multiStopRuns*150+(this.data.bonusXp||0);const {bonuses,convoyIds,...rest}=this.data;return {...rest,xp,level:Math.max(1,Math.floor(Math.sqrt(xp/500))+1),nextLevelXp:Math.pow(Math.floor(Math.sqrt(xp/500))+1,2)*500,availableAchievements:ACHIEVEMENTS.map(([id,name])=>({id,name,unlocked:this.data.achievements.some(a=>a.id===id)}))};}
}
module.exports={CareerManager};
