const DEFAULTS = Object.freeze({radius:.12,radiusBasis:"screen",areaToScreen:1,sweep:true,multiCatch:true,forgive:2,magnet:.25,liftMs:250,nearRing:2.5,cornerDeg:50,dotSpacing:.2,catchRule:"easy"});
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export function validateItemSet(obj){
 const errors=[]; const err=(p,m)=>errors.push(`${p}: ${m}`);
 if(!obj||typeof obj!=="object"||Array.isArray(obj)) return {ok:false,errors:["$: expected object"]};
 const top=new Set(["format","id","script","dir","style","license","items"]);
 for(const k of Object.keys(obj)) if(!top.has(k)) err(`$.${k}`,"unknown key");
 if(obj.format!=="dot-tracer-items/1") err("$.format","wrong format");
 if(typeof obj.id!=="string"||!obj.id) err("$.id","expected non-empty string");
 if(typeof obj.script!=="string"||!/^[A-Z][a-z]{3}$/.test(obj.script)) err("$.script","invalid ISO 15924 code");
 if(own(obj,"dir")&&!['ltr','rtl'].includes(obj.dir)) err("$.dir","invalid direction");
 if(own(obj,"style")&&typeof obj.style!=="string") err("$.style","expected string");
 if(own(obj,"license")&&(!obj.license||typeof obj.license!=="object"||Array.isArray(obj.license))) err("$.license","expected object");
 if(!obj.items||typeof obj.items!=="object"||Array.isArray(obj.items)||!Object.keys(obj.items).length) err("$.items","expected items");
 else for(const [id,item] of Object.entries(obj.items)) validateItem(item,`$.items.${id}`,err);
 return {ok:!errors.length,errors};
}
function validateItem(item,p,err){
 if(!item||typeof item!=="object"||Array.isArray(item)){err(p,"expected object");return}
 const keys=new Set(["char","case","kind","aspect","reveal","strokes"]); for(const k of Object.keys(item))if(!keys.has(k))err(`${p}.${k}`,"unknown key");
 if(!finite(item.aspect)||item.aspect<=0||item.aspect>5)err(`${p}.aspect`,"out of range");
 if(own(item,"char")&&typeof item.char!=="string")err(`${p}.char`,"expected string");
 if(own(item,"case")&&!['upper','lower','none'].includes(item.case))err(`${p}.case`,"invalid case");
 if(own(item,"kind")&&!['letter','digit','shape'].includes(item.kind))err(`${p}.kind`,"invalid kind");
 if(own(item,"reveal")){const r=item.reveal;if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).some(k=>k!=="image")||typeof r.image!=="string"||/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(r.image))err(`${p}.reveal`,"invalid relative image")}
 if(!Array.isArray(item.strokes)||item.strokes.length<1||item.strokes.length>64){err(`${p}.strokes`,"expected 1..64 strokes");return}
 item.strokes.forEach((s,i)=>{const q=`${p}.strokes[${i}]`;if(!s||typeof s!=="object"||Array.isArray(s)){err(q,"expected object");return}const allowed=new Set(["points","dots","hints"]);for(const k of Object.keys(s))if(!allowed.has(k))err(`${q}.${k}`,"unknown key");checkPoints(s.points,`${q}.points`,err);if(own(s,"dots"))checkPoints(s.dots,`${q}.dots`,err);if(own(s,"hints")){if(!Array.isArray(s.hints))err(`${q}.hints`,"expected array");else s.hints.forEach((h,j)=>{if(!h||typeof h!=="object"||Array.isArray(h)||Object.keys(h).some(k=>!['at','dx','dy'].includes(k))||!finite(h.at)||h.at<0||h.at>1||!finite(h.dx)||!finite(h.dy))err(`${q}.hints[${j}]`,"invalid hint")})}})
}
function checkPoints(a,p,err){if(!Array.isArray(a)||a.length<1||a.length>2000){err(p,"expected 1..2000 points");return}a.forEach((v,i)=>{if(!Array.isArray(v)||v.length!==2||!v.every(n=>finite(n)&&n>=0&&n<=1))err(`${p}[${i}]`,"invalid point")})}

function distPointSeg(p,a,b){const vx=b[0]-a[0],vy=b[1]-a[1],d=vx*vx+vy*vy;if(!d)return {d:Math.hypot(p[0]-a[0],p[1]-a[1]),u:0};const u=clamp(((p[0]-a[0])*vx+(p[1]-a[1])*vy)/d,0,1);return {d:Math.hypot(p[0]-a[0]-u*vx,p[1]-a[1]-u*vy),u}}
function easy(ctx){
 if(ctx.predicted)return []; const {P,P0,dots,di,settings}=ctx, out=[]; let cursor=di,lastU=-1;
 const reached=(i,r=ctx.r)=>{if(P0&&settings.sweep&&Math.hypot(P[0]-P0[0],P[1]-P0[1])<=.4){const z=distPointSeg(dots[i],P0,P);return z.d<=r&&z.u>=lastU?(lastU=z.u,true):false}return Math.hypot(P[0]-dots[i][0],P[1]-dots[i][1])<=r};
 let r=ctx.r;if(P0){const mv=[P[0]-P0[0],P[1]-P0[1]],to=[dots[di][0]-P0[0],dots[di][1]-P0[1]],ml=Math.hypot(...mv),tl=Math.hypot(...to),now=Math.hypot(P[0]-dots[di][0],P[1]-dots[di][1]);if(ml&&tl&&now<tl&&(mv[0]*to[0]+mv[1]*to[1])/(ml*tl)>=.5)r*=1+2*settings.magnet}
 if(!reached(di,r)&&di>0&&settings.forgive>0&&(!P0||Math.hypot(P[0]-dots[di][0],P[1]-dots[di][1])>=Math.hypot(P0[0]-dots[di][0],P0[1]-dots[di][1]))){let target=-1;for(let i=di+1;i<=Math.min(dots.length-1,di+settings.forgive);i++)if(reached(i,r)){target=i;break}if(target>=0){for(;cursor<target;cursor++)out.push({index:cursor,mark:"filled"});out.push({index:cursor++,mark:"caught"})}}
 else if(reached(di,r))out.push({index:cursor++,mark:"caught"});
 if(out.length&&settings.multiCatch)while(cursor<dots.length&&reached(cursor)){out.push({index:cursor++,mark:"caught"})}
 return out;
}

export function createDotTracer(options={}){
 let settings={...DEFAULTS}, set=null, ids=[], current=null, strokes=[], si=0,di=0,done=0,filled=0,complete=false,penDown=false,needLift=false,last=null,lastT=null,lastReal=null;
 const listeners=new Map(), clock=options&&options.clock, easyRule={name:"easy",sample:easy}; let rule=validRule(options&&options.catchRule)?options.catchRule:easyRule;
 settings.catchRule=rule.name;
 const emit=(type,data={},bucket=[])=>{const e={type,item:current,...data};bucket.push(e);for(const fn of listeners.get(type)||[])try{fn(e)}catch{}return e};
 const scales=()=>{const a=set.items[current].aspect;return [a<=1?a:1,a<=1?1:1/a]};
 const makeDots=item=>item.strokes.map(s=>s.dots?s.dots.map(p=>({x:p[0],y:p[1]})):generate(s.points,item.aspect,settings));
 function reset(){si=di=done=filled=0;complete=false;penDown=false;needLift=false;last=null;lastT=null;lastReal=null;try{rule.reset?.()}catch{}}
 function show(id){if(!set||!own(set.items,id))return {ok:false,error:"unknown_item"};current=id;strokes=makeDots(set.items[id]);reset();emit("start");return {ok:true,id}}
 function nav(delta){if(!ids.length)return {ok:false,error:"unknown_item"};const at=current?ids.indexOf(current):-1;return show(ids[(at<0?(delta>0?0:ids.length-1):(at+delta+ids.length)%ids.length)])}
 function timestamp(v){if(v===undefined)try{v=clock?.now()}catch{return null}return finite(v)?v:null}
 function pointer(ev){const events=[];try{if(!ev||typeof ev!=="object"||!['down','move','up','cancel'].includes(ev.type)||!current||complete)return {accepted:false,events};const t=timestamp(ev.t);if(t===null)return {accepted:false,events};if((ev.type==='up'||ev.type==='cancel')?lastT!==null&&t<lastT:lastT!==null&&t<=lastT)return {accepted:false,events};if(ev.type==='up'||ev.type==='cancel'){lastT=t;if(penDown||last){emit('lift',{},events);needLift=true}penDown=false;last=null;return {accepted:true,events}}
 if(!finite(ev.x)||!finite(ev.y))return {accepted:false,events};const [xs,ys]=scales(),P=[ev.x*xs,ev.y*ys],gap=lastT===null?null:t-lastT;let P0=last;if(ev.type==='down'||ev.signalLost||(gap!==null&&gap>=settings.liftMs)){if(last&&(gap>=settings.liftMs))emit('lift',{},events);P0=null;needLift=gap>=settings.liftMs}lastT=t;penDown=true;
 if(ev.signalLost){last=null;try{rule.signalLost?.()}catch{}return {accepted:true,events}}
 const target=[strokes[si][di].x*xs,strokes[si][di].y*ys],dd=Math.hypot(P[0]-target[0],P[1]-target[1]);if(dd<=settings.nearRing*effective())emit('near',{stroke:si,index:di,dist:dd,dir:dd?[ (P[0]-target[0])/dd,(P[1]-target[1])/dd]:[0,0]},events);
 const ctx={P,P0,dots:strokes[si].map(q=>[q.x*xs,q.y*ys]),di,stroke:si,r:effective(),settings:{...settings},t,gapMs:gap,discontinuity:!P0,predicted:ev.predicted===true,msSinceReal:lastReal===null?null:t-lastReal};let commits=[];try{commits=rule.sample(ctx)}catch{}if(!Array.isArray(commits))commits=[];
 let expect=di;for(const c of commits){if(!c||c.index!==expect||!['caught','filled'].includes(c.mark)){commits=[];break}expect++}
 for(const c of commits){if(c.index>=strokes[si].length)break;const was=di++;done++;if(c.mark==='filled')filled++;emit('dot',{stroke:si,index:was,n:done,total:strokes.reduce((n,s)=>n+s.length,0),strokeStart:was===0,filled:c.mark==='filled'},events);if(di===strokes[si].length){const ended=si;emit('stroke',{stroke:ended},events);try{rule.strokeDone?.()}catch{}if(si===strokes.length-1){complete=true;emit('done',{},events);emit('reveal',{image:set.items[current].reveal?.image||null},events)}else{si++;di=0;last=null;needLift=true}break}}
 last=complete||needLift?null:P;if(!ev.predicted)lastReal=t;needLift=false;return {accepted:true,events}}catch{return {accepted:false,events}}}
 function effective(){return settings.radiusBasis==='screen'?settings.radius/settings.areaToScreen:settings.radius}
 function configure(o){const ignored=[];if(!o||typeof o!=="object"||Array.isArray(o))return {ok:false,ignored:['settings']};for(const [k,v] of Object.entries(o)){if(k==='catchRule'){if(v==='easy'){rule=easyRule;settings.catchRule='easy'}else ignored.push(k);continue}const ranges={radius:[.01,.5],areaToScreen:[.05,2],forgive:[0,8],magnet:[0,1],liftMs:[50,2000],nearRing:[1,6],cornerDeg:[0,180],dotSpacing:[.01,1]};if(k==='radiusBasis'&&['screen','area'].includes(v))settings[k]=v;else if(['sweep','multiCatch'].includes(k)&&typeof v==='boolean')settings[k]=v;else if(ranges[k]&&finite(v))settings[k]=clamp(['forgive'].includes(k)?Math.round(v):v,...ranges[k]);else ignored.push(k)}return {ok:true,ignored,settings:{...settings}}}
 function load(obj){const v=validateItemSet(obj);if(!v.ok)return {...v,count:0};set=structuredCopy(obj);ids=Object.keys(set.items);current=null;strokes=[];reset();return {ok:true,errors:[],count:ids.length}}
 const api={validateItemSet,loadItemSet:load,listItems:()=>ids.slice(),show,next:()=>nav(1),prev:()=>nav(-1),restart:()=>current?show(current):{ok:false,error:'unknown_item'},repeat:()=>current?show(current):{ok:false,error:'unknown_item'},pointer,tick(t){const x=timestamp(t);if(x===null||lastT!==null&&x<lastT)return {accepted:false,events:[]};const events=[];if(last&&x-lastT>=settings.liftMs){emit('lift',{},events);last=null;penDown=false;needLift=true}lastT=x;return {accepted:true,events}},getDots(){let n=0;return strokes.flatMap((s,a)=>s.map((p,b)=>({stroke:a,index:b,n:++n,x:p.x,y:p.y,done:a<si||(a===si&&b<di)||complete,next:!complete&&a===si&&b===di})))},getItem:()=>current?{id:current,aspect:set.items[current].aspect,strokes:strokes.map(s=>s.map(p=>({...p})))}:null,getState:()=>({item:current,strokeIndex:si,dotIndex:di,doneDots:done,filledDots:filled,totalDots:strokes.reduce((n,s)=>n+s.length,0),strokeCount:strokes.length,complete,penDown,needLift,settings:{...settings}}),configure,getSettings:()=>({...settings}),getEffectiveRadius:effective,applyPreset(name){if(name!=='kids')return {ok:false,error:'unknown_preset'};const area=settings.areaToScreen;settings={...DEFAULTS,areaToScreen:area};rule=easyRule;return {ok:true}},setCatchRule(r){if(!validRule(r))return {ok:false,error:'invalid_catch_rule'};rule=r;settings.catchRule=r.name;return {ok:true}},on(name,fn){if(typeof name!=="string"||typeof fn!=="function")return ()=>{};if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);return()=>listeners.get(name)?.delete(fn)}};return api;
}
function validRule(r){return !!r&&typeof r==='object'&&typeof r.name==='string'&&r.name&&typeof r.sample==='function'}
function structuredCopy(o){return JSON.parse(JSON.stringify(o))}
function generate(points,aspect,settings){const scale=p=>[p[0]*(aspect<=1?aspect:1),p[1]*(aspect<=1?1:1/aspect)], src=[];for(const p of points)if(!src.length||p[0]!==src.at(-1)[0]||p[1]!==src.at(-1)[1])src.push(p);if(src.length<2)return src.map(p=>({x:p[0],y:p[1]}));const keep=[0];for(let i=1;i<src.length-1;i++){const a=scale(src[i-1]),b=scale(src[i]),c=scale(src[i+1]),u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]],ang=Math.acos(clamp((u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1),-1,1))*180/Math.PI;if(180-ang>=settings.cornerDeg)keep.push(i)}keep.push(src.length-1);const out=[src[0]];for(let k=1;k<keep.length;k++){const a=src[keep[k-1]],b=src[keep[k]],A=scale(a),B=scale(b),n=Math.ceil(Math.hypot(B[0]-A[0],B[1]-A[1])/settings.dotSpacing);for(let j=1;j<=n;j++)out.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n])}return out.map(p=>({x:p[0],y:p[1]}))}
