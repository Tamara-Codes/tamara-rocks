const fs = require('node:fs');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
console.log('Ready for private database verification input.');
const rl=readline.createInterface({input:process.stdin,terminal:false});
rl.once('line',async line=>{
 rl.close(); process.stdin.pause();
 try {
  const config=JSON.parse(line);
  const url=new URL(config.connection);
  if (url.hostname !== config.expectedHost || url.hostname.includes('-pooler')) throw new Error('Direct verified database host required.');
  if (config.mode !== 'apply' && url.hostname.includes('ep-orange-waterfall-b2wrfl0v')) throw new Error('Integration tests cannot target production.');
  const sql=neon(config.connection);
  const statements=fs.readFileSync('migrations/20261119_workshop_feedback.sql','utf8').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(s=>s&&!/^(BEGIN|COMMIT)$/i.test(s));
  await sql.transaction(statements.map(s=>sql.query(s)));
  console.log('Migration applied atomically: '+statements.length+' statements.');
  if(config.mode==='apply') return;
  await sql.transaction(statements.map(s=>sql.query(s)));
  process.env.DATABASE_URL=config.connection;
  const handler=require('../api/workshop-feedback');
  const marker='Storage verification '+randomUUID();
  for(const permission of ['private','anonymous','named']) {
   const res={code:0,setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
   await handler({method:'POST',headers:{origin:'https://www.tamara.rocks','x-vercel-forwarded-for':'192.0.2.'+(20+['private','anonymous','named'].indexOf(permission))},body:{takeaway:marker,improvement:'Synthetic development test.',firstName:permission==='named'?'Preview':'',publicationPermission:permission}},res);
   if(res.code!==200||res.body.ok!==true) throw new Error('Handler failed for '+permission+' ('+res.code+').');
  }
  const rows=await sql.query('SELECT publication_permission, review_status, permission_version, first_name FROM workshop_feedback WHERE takeaway = $1 ORDER BY publication_permission',[marker]);
  if(rows.length!==3||rows.some(r=>r.review_status!=='unreviewed'||r.permission_version!=='2026-11-19-v1')) throw new Error('Stored permission verification failed.');
  for (const [text,permission,name] of [['','private',''],['Test','named','']]) {
   let blocked=false;
   try { await sql.query('INSERT INTO workshop_feedback (workshop_slug,takeaway,first_name,publication_permission,permission_version,permission_prompt,permission_choice,permission_recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())',['ai-demystified-free',text,name,permission,'test','test','test']); }
   catch (e) { if(e.code==='23514') blocked=true; else throw e; }
   if(!blocked) throw new Error('Database constraint did not reject invalid data.');
  }
  console.log('PASS: migration is idempotent; real handler stored all three permission choices privately; invalid rows rejected. Synthetic records retained only on development branch.');
 } catch(error) {console.error('Database verification failed: '+(error.code||'')+' '+String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1;}
});
