import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from '../tool.mjs';
const env = { HERMES_REVIEW_TOKEN: 'offline-test', ADMIN_WORKER_TOKEN: 'offline-admin' };
test('rights tools use the existing worker bridge without exposing GitHub read credentials', async () => {
 const calls=[];const result=await runTool({target:'requests',action:'sync'},{...env,SUBMISSION_GITHUB_TOKEN:'read-only'},async(url,options)=>{calls.push({url,options});return Response.json({ok:true,tasks:[]});});
 assert.equal(calls[0].url,'http://127.0.0.1:3100/cms-api/request-agent');
 assert.equal(calls[0].options.headers['X-GitHub-Read-Token'],'read-only');
 assert.equal(JSON.stringify(result).includes('read-only'),false);
 await assert.rejects(()=>runTool({target:'requests',action:'ack'},env),/Invalid tool/);
});
test('SSH bridge only accesses loopback business API and returns field errors', async () => {
 const calls=[];
 const fetchImpl=async (url,options)=>{calls.push({url,options});return Response.json({error:'i18n.ja.tags invalid',path:'i18n.ja.tags'},{status:422});};
 const value=await runTool({target:'admin',action:'locale'},env,fetchImpl);
 assert.equal(value.status,422);assert.equal(value.path,'i18n.ja.tags');
 assert.equal(calls[0].url,'http://127.0.0.1:3100/cms-api/agent');
 await assert.rejects(()=>runTool({target:'submission',action:'list'},{...env,HERMES_REVIEW_API_URL:'https://example.com'},fetchImpl),/loopback/);
 assert.equal(calls.length,1);
});
test('completed submission triggers mirror synchronization, never model calls',async()=>{
 const calls=[];const fetchImpl=async url=>{calls.push(url);return Response.json({ok:true});};
 await runTool({target:'submission',action:'complete'},env,fetchImpl);
 assert.deepEqual(calls,['http://127.0.0.1:8790/api/v1/internal/agent','http://127.0.0.1:3100/cms-api/submissions/sync']);
});
