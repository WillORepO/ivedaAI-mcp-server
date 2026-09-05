import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, it } from 'vitest';
import { policyFromEnv } from '../src/accessPolicy.js';
import { buildTriggerBody, mergeTriggerIntoRule } from '../src/alertTrigger.js';

async function withMcp(handler: (req: IncomingMessage, res: ServerResponse) => void, run: (client: Client) => Promise<void>, env: Record<string,string> = {}) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as {port:number}).port;
  const client = new Client({name:'audit-regression',version:'1'});
  const transport = new StdioClientTransport({command:process.execPath, args:['--import','tsx',fileURLToPath(new URL('../src/index.ts',import.meta.url))], env:{
    ...Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!k.startsWith('IVEDAAI_'))) as Record<string,string>,
    IVEDAAI_BASE_URL:`http://127.0.0.1:${port}`,IVEDAAI_USERNAME:'fixture-user',IVEDAAI_PASSWORD:'fixture-password',IVEDAAI_TIMEOUT_MS:'1000',...env,
  },stderr:'pipe'});
  try { await client.connect(transport); await run(client); }
  finally { await client.close(); server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); }
}
function token(req:IncomingMessage,res:ServerResponse):boolean {
  if(req.url?.startsWith('/ainvr/api/oauth2/token')) { res.setHeader('content-type','application/json'); res.end(JSON.stringify({access_token:'fixture-token',expires_in:600})); return true; } return false;
}

it('preserves camera abnormal conditions when applying a webhook',async()=>{
  let patched:Record<string,unknown>|undefined;
  await withMcp((req,res)=>{
    if(token(req,res))return;
    res.setHeader('content-type','application/json');
    if(req.method==='GET'){res.end(JSON.stringify({alertName:'owned-rule',alertType:'CAMERA_ABNORMAL',isEnabled:false,alertRulePermissions:[{cameraId:42}],schedule:{forever:true,weekdays:null},condition:JSON.stringify({abnormalTypes:['Disconnect'],typeLogic:'and',cooldownInterval:60})}));return;}
    let data='';req.on('data',c=>data+=c);req.on('end',()=>{patched=JSON.parse(data);res.statusCode=Array.isArray(patched?.abnormalTypes)?200:400;res.end('{}');});
  },async c=>{
    const r=await c.callTool({name:'ivedaai_alert_integration',arguments:{action:'apply',type:'request',alertRuleId:'owned-rule',config:{method:'POST',url:'https://example.invalid/test'}}});
    expect(r.isError).toBe(false);
    expect(patched).toMatchObject({abnormalTypes:['Disconnect'],cameraIds:[42],isEnabled:false,enableForever:true,cooldownInterval:60});
  });
});

it('rejects an ambiguous raw webhook body and preserves the documented object',()=>{
  expect(()=>buildTriggerBody('request',{method:'POST',url:'https://example.invalid/test',httpBody:{type:'RAW',raw:'{"test":true}'}})).toThrow(/raw.*content/i);
  const raw={content:'{"test":true}',contentType:'application/json'};
  expect(buildTriggerBody('request',{method:'POST',url:'https://example.invalid/test',httpBody:{type:'RAW',raw}})).toMatchObject({trigger:{request:{requests:[{httpBody:{type:'RAW',raw}}]}}});
});

it('does not turn missing or malformed camera associations into an empty target list',()=>{
  const rule={alertName:'owned',alertType:'CAMERA_ABNORMAL'};
  for(const permissions of [undefined,null,[{}],[{cameraId:42},{}]]) {
    const result=mergeTriggerIntoRule({...rule,alertRulePermissions:permissions},{trigger:{}},[]);
    expect(result.missingRequired).toContain('cameraIds');
    expect(result.body).not.toHaveProperty('cameraIds');
  }
  expect(mergeTriggerIntoRule({...rule,alertRulePermissions:[]},{trigger:{}},[]).body.cameraIds).toEqual([]);
});

it('never exposes credential fields from a response truncated in the middle of JSON', async()=> {
  await withMcp((req,res)=> { if(token(req,res))return;res.setHeader('content-type','application/json');res.end(JSON.stringify({password:'truncated-secret-sentinel',padding:'x'.repeat(500)})); },async c=> {
    const r=await c.callTool({name:'ivedaai_camera',arguments:{operation:'GET /api/cameras'}});
    expect(r.structuredContent).toMatchObject({truncated:true});
    expect(JSON.stringify(r)).not.toContain('truncated-secret-sentinel');
  },{IVEDAAI_MAX_RESPONSE_BYTES:'90'});
});

it('never activates a pre-existing camera after a failed create',async()=>{
  let activations=0;
  await withMcp((req,res)=>{
    if(token(req,res))return;
    res.setHeader('content-type','application/json');
    if(req.method==='POST'&&req.url==='/ainvr/api/cameras?ainvrId=1'){res.writeHead(409);res.end('{}');return;}
    if(req.url?.includes('/jobs')){activations++;res.end('{}');return;}
    res.end(JSON.stringify({content:[{cameraId:77,name:'existing-camera'}]}));
  },async c=>{
    const r=await c.callTool({name:'ivedaai_add_camera',arguments:{ainvrId:1,cameras:[{name:'existing-camera',streamUrl:'rtsp://fixture/stream',engineProfileId:1}]}});
    expect(r.isError).toBe(true);expect(activations).toBe(0);
  });
});

it('reports camera activation failures as tool errors and keeps passwords out of warnings',async()=>{
  await withMcp((req,res)=>{
    if(token(req,res))return;res.setHeader('content-type','application/json');
    if(req.url?.includes('/jobs')){res.writeHead(503);res.end('{}');return;}
    res.end(JSON.stringify({cameraId:9}));
  },async c=>{
    const r=await c.callTool({name:'ivedaai_add_camera',arguments:{ainvrId:1,cameras:[{name:'fixture-camera',ip:'192.0.2.1',account:'fixture-user',password:'camera-secret-sentinel',engineProfileId:1}]}});
    expect(r.isError).toBe(true);expect(JSON.stringify(r)).not.toContain('camera-secret-sentinel');
  });
});

it('rejects malformed successful OAuth responses before calling the API',async()=>{
  let apiCalls=0;
  await withMcp((req,res)=>{if(!req.url?.includes('/oauth2/token'))apiCalls++;res.setHeader('content-type','application/json');res.end('{}');},async c=>{
    const r=await c.callTool({name:'ivedaai_camera',arguments:{operation:'GET /api/cameras'}});
    expect(r.isError).toBe(true);expect(apiCalls).toBe(0);
  });
});

it('preserves completed camera results and stops a batch after an uncertain write',async()=>{
  let creates=0;
  await withMcp((req,res)=>{
    if(token(req,res))return;
    if(++creates===2){req.socket.destroy();return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify({cameraId:9}));
  },async c=>{
    const r=await c.callTool({name:'ivedaai_add_camera',arguments:{ainvrId:1,activate:false,cameras:['one','two','three'].map(name=>({name,streamUrl:'rtsp://fixture/stream',engineProfileId:1}))}});
    expect(r.isError).toBe(true);expect(creates).toBe(2);
    expect(r.structuredContent).toMatchObject({results:[{name:'one',outcome:'created',cameraId:9},{name:'two',outcome:'failed'}]});
  });
});

it('refuses to call a camera created when its successful response contains no id',async()=>{
  let calls=0;
  await withMcp((req,res)=>{
    if(token(req,res))return;calls++;res.setHeader('content-type','application/json');res.end('{}');
  },async c=>{
    const r=await c.callTool({name:'ivedaai_add_camera',arguments:{ainvrId:1,cameras:[{name:'fixture',streamUrl:'rtsp://fixture/stream',engineProfileId:1}]}});
    expect(r.isError).toBe(true);expect(calls).toBe(1);
  });
});

it('redacts secret query parameters in the returned request URL',async()=>{
  await withMcp((req,res)=>{if(token(req,res))return;res.setHeader('content-type','application/json');res.end('{}');},async c=>{
    const r=await c.callTool({name:'ivedaai_nvr',arguments:{operation:'GET /api/nvrs/{nvrType}/alerts',path:{nvrType:'avigilon'},query:{ip:'192.0.2.1',port:'80',username:'fixture',password:'query-secret-sentinel'}}});
    expect(r.isError).toBe(false);expect(JSON.stringify(r)).not.toContain('query-secret-sentinel');
  });
});

it('does not replay login credentials to a redirect destination',async()=>{
  let redirected=0;
  await withMcp((req,res)=>{
    if(req.url==='/redirect-sink'){redirected++;res.end('{}');return;}
    res.writeHead(307,{location:'/redirect-sink'});res.end();
  },async c=>{
    const r=await c.callTool({name:'ivedaai_camera',arguments:{operation:'GET /api/cameras'}});
    expect(r.isError).toBe(true);expect(redirected).toBe(0);
  });
});

it('does not expose raw authentication failure bodies',async()=>{
  await withMcp((_req,res)=>{res.writeHead(401);res.end('password=oauth-secret-sentinel');},async c=>{
    const r=await c.callTool({name:'ivedaai_camera',arguments:{operation:'GET /api/cameras'}});
    expect(r.isError).toBe(true);expect(JSON.stringify(r)).not.toContain('oauth-secret-sentinel');
  });
});

it('rejects dot-segment identifiers before authentication or API traffic',async()=>{
  let received=0;
  await withMcp((req,res)=>{received++;if(token(req,res))return;res.end('{}');},async c=>{
    const r=await c.callTool({name:'ivedaai_camera',arguments:{operation:'GET /api/cameras/{cameraId}',path:{cameraId:'..'}}});
    expect(r.isError).toBe(true);expect(received).toBe(0);
  });
});

it('publishes and transmits recovered file parts and multipart body fields',async()=>{
  const root=mkdtempSync(join(tmpdir(),'mcp-audit-')); const file=join(root,'fixture.jpg');writeFileSync(file,'fixture-image');
  const received:string[]=[];
  try { await withMcp((req,res)=>{if(token(req,res))return;const chunks:Buffer[]=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{received.push(Buffer.concat(chunks).toString());res.setHeader('content-type','application/json');res.end('{}');});},async c=>{
    const {tools}=await c.listTools();
    expect(tools.find(t=>t.name==='ivedaai_image')?.inputSchema.properties).toHaveProperty('file');
    expect(tools.find(t=>t.name==='ivedaai_image')?.inputSchema.properties).toHaveProperty('body');
    const r=await c.callTool({name:'ivedaai_image',arguments:{operation:'POST /api/image/rotate',file:{path:file},body:{usrFileName:'fixture.jpg'}}});
    expect(r.isError).toBe(false);expect(received[0]).toContain('name="file"');expect(received[0]).toContain('fixture.jpg');
    const colors=await c.callTool({name:'ivedaai_detection',arguments:{operation:'POST /api/detection/colors',file:{path:file},body:{sentinel:'side-payload'}}});
    expect(colors.isError).toBe(false);expect(received[1]).toContain('side-payload');
  },{IVEDAAI_UPLOAD_ROOT:root}); } finally {rmSync(root,{recursive:true,force:true});}
});

it('reports query-only alert tools as read-only and update tools as potentially destructive',async()=>{
  await withMcp((req,res)=>{if(!token(req,res))res.end('{}');},async c=>{
    const {tools}=await c.listTools(); expect(tools.find(t=>t.name==='ivedaai_alert')?.annotations?.readOnlyHint).toBe(true);
  },{IVEDAAI_READ_ONLY:'true'});
  await withMcp((req,res)=>{if(!token(req,res))res.end('{}');},async c=>{
    const {tools}=await c.listTools();expect(tools.find(t=>t.name==='ivedaai_alert_integration')?.annotations?.destructiveHint).toBe(true);
  });
});

it.each(['', '.', '..'])('rejects an unsafe record id %j on DELETE without network traffic',async id=>{
  let received=0;
  await withMcp((req,res)=>{received++;if(!token(req,res))res.end('{}');},async c=>{
    const r=await c.callTool({name:'ivedaai_camera',arguments:{operation:'DELETE /api/cameras/{cameraId}',path:{cameraId:id}}});
    expect(r.isError).toBe(true);expect(received).toBe(0);
  });
});

it('does not let an empty array erase a required query target on DELETE',async()=>{
  let received=0;
  await withMcp((req,res)=>{received++;if(!token(req,res))res.end('{}');},async c=>{
    const r=await c.callTool({name:'ivedaai_account',arguments:{operation:'DELETE /api/accounts/api-keys',query:{apiKeyIds:[]}}});
    expect(r.isError).toBe(true);expect(received).toBe(0);
  });
});

it('cancellation closes the in-progress API request',async()=>{
  let started!:()=>void,closed!:()=>void;
  const startedPromise=new Promise<void>(r=>started=r),closedPromise=new Promise<void>(r=>closed=r);
  await withMcp((req,res)=>{if(token(req,res))return;started();res.on('close',closed);},async c=>{
    const controller=new AbortController();
    const pending=c.callTool({name:'ivedaai_camera',arguments:{operation:'GET /api/cameras'}},undefined,{signal:controller.signal}).catch(()=>undefined);
    await startedPromise;controller.abort();await pending;
    await Promise.race([closedPromise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('API request did not cancel')),700))]);
  },{IVEDAAI_TIMEOUT_MS:'10000'});
});

it('a late 401 does not invalidate a newer token obtained by a concurrent request',async()=>{
  let logins=0,oldCalls=0;
  await withMcp((req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.includes('/oauth2/token')){logins++;res.end(JSON.stringify({access_token:`token-${logins}`,expires_in:600}));return;}
    if(req.headers.authorization==='Bearer token-1'){
      oldCalls++;const wait=oldCalls===1?0:150;
      setTimeout(()=>{res.writeHead(401);res.end('{}');},wait);return;
    }
    res.end('{}');
  },async c=>{
    const args={name:'ivedaai_camera',arguments:{operation:'GET /api/cameras'}};
    const r=await Promise.all([c.callTool(args),c.callTool(args)]);
    expect(r.every(x=>!x.isError)).toBe(true);expect(oldCalls).toBe(2);expect(logins).toBe(2);
  });
});

it('retains complete redacted SSE events and drops the incomplete tail',async()=>{
  await withMcp((req,res)=>{if(token(req,res))return;res.writeHead(200,{'content-type':'text/event-stream'});
    res.write('data: {"password":"sse-complete-secret","count":1}\n\ndata: {"password":"sse-incomplete-secret');
  },async c=>{
    const r=await c.callTool({name:'ivedaai_sse',arguments:{operation:'GET /api/system/events'}});
    expect(r.structuredContent).toMatchObject({timedOut:true});
    expect(JSON.stringify(r)).not.toContain('sse-complete-secret');expect(JSON.stringify(r)).not.toContain('sse-incomplete-secret');
    expect(JSON.stringify(r)).toContain('count');
  },{IVEDAAI_TIMEOUT_MS:'200'});
});

it('accepts a complete body exactly at its byte cap without truncation',async()=>{
  await withMcp((req,res)=>{if(token(req,res))return;res.setHeader('content-type','application/json');res.end('{"ok":true}');},async c=>{
    const r=await c.callTool({name:'ivedaai_camera',arguments:{operation:'GET /api/cameras'}});
    expect(r.structuredContent).toMatchObject({body:{ok:true}});expect(r.structuredContent).not.toHaveProperty('truncated');
  },{IVEDAAI_MAX_RESPONSE_BYTES:'11'});
});

it('rejects ambiguous read-only settings instead of silently enabling writes',()=>{
  expect(()=>policyFromEnv({IVEDAAI_READ_ONLY:'TRUE'})).toThrow('IVEDAAI_READ_ONLY');
  expect(()=>policyFromEnv({IVEDAAI_ALLOW_COLLECTION_DELETE:'1'})).toThrow('IVEDAAI_ALLOW_COLLECTION_DELETE');
});

it.each(['2026-09-04 13:00:00', '20260931130000', '20260904250000'])(
  'rejects the unsafe legacy upload timestamp %s before network traffic', async startTime => {
    let requests = 0;
    await withMcp((req, res) => {
      requests++; if (token(req, res)) return;
      res.setHeader('content-type', 'application/json'); res.end('{}');
    }, async c => {
      const r = await c.callTool({ name: 'ivedaai_job', arguments: {
        operation: 'POST /api/jobs', query: { type: 'UploadJob', cameraId: 1, startTime, endTime: '20260904130012' },
      }});
      expect(r.isError).toBe(true); expect(requests).toBe(0);
      expect(JSON.stringify(r)).toContain('yyyyMMddHHmmss');
    });
  }
);

it('preserves documented compact timestamps on legacy upload requests', async () => {
  let observed: string | null = null;
  await withMcp((req, res) => {
    if (token(req, res)) return;
    observed = new URL(req.url!, 'http://localhost').searchParams.get('startTime');
    res.setHeader('content-type', 'application/json'); res.end('{}');
  }, async c => {
    const r = await c.callTool({ name: 'ivedaai_job', arguments: {
      operation: 'POST /api/jobs', query: { type: 'UploadJob', cameraId: 1, startTime: '20260904130000', endTime: '20260904130012' },
    }});
    expect(r.isError).toBe(false); expect(observed).toBe('20260904130000');
  });
});
