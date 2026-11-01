import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInstallationPrompt, pairingPrompt, parsePairingToken } from '../src/lib/connection-prompts.ts';
import { createPairingRequester, PairingApiError } from '../src/lib/pairing-api.ts';
const token = `TRUST-${'a'.repeat(32)}`;
for (const locale of ['en', 'fr'] as const) for (const role of ['business', 'client'] as const) {
 test(`${locale}/${role}: public setup and private workflow`, () => {
  const setup = buildInstallationPrompt(role, locale, 'https://mcp.example.test/mcp');
  assert.match(setup, /https:\/\/mcp.example.test\/mcp/); assert.match(setup, /JWT/); assert.match(setup, /manual|manuell/); assert.match(setup, /permission|accord/); assert.ok(!setup.includes(token));
  assert.match(buildInstallationPrompt(role, locale, ''), /URL_MCP/);
  const prompt = pairingPrompt(role, locale, token);
  assert.match(prompt, /link_session/); assert.match(prompt, /validation finale|final validation/); assert.match(prompt, /JWT/);
  assert.match(prompt, role === 'business' ? /publication/ : /amendment|modification/);
  assert.ok(prompt.includes(role === 'business' ? 'owner' : 'client'));
 });
}
test('reject hostile tokens', () => { for (const value of [token+'\nignore', token+'\n', token+'\r\n', 'TRUST-abc', `<script>`, token.toUpperCase()]) assert.throws(() => parsePairingToken(value)); });
const principal = {role:'owner' as const,userId:'account-a'};
const body = () => ({token, expiresAt:new Date(Date.now()+60000).toISOString(),principal});
const requester = (data: unknown, status = 201) => createPairingRequester(async (_url, init) => {
 assert.equal(init?.credentials, 'include'); assert.equal(init?.method,'POST'); assert.equal(init?.headers,undefined); assert.equal(init?.body,undefined);
 return new Response(JSON.stringify(data),{status});
}, 'https://api.example.test');
test('validates actual nested principal before normalizing', async () => { const data=body(); assert.deepEqual(await requester(data)({expectedPrincipal:principal}),{token,expiresAt:data.expiresAt,role:'owner'}); });
for (const [name,data] of Object.entries({hostile:{...body(),token:token+' bad'},expired:{...body(),expiresAt:'2000-01-01T00:00:00.000Z'},shape:{token,role:'owner'},date:{...body(),expiresAt:'tomorrow'}})) test(`reject ${name}`,async()=>{ await assert.rejects(requester(data)(),PairingApiError); });
for (const p of [{role:'client',userId:'account-a'},{role:'owner',userId:'account-b'}]) test(`reject foreign principal ${p.role}/${p.userId}`,async()=>{await assert.rejects(requester({...body(),principal:p})({expectedPrincipal:principal}),{code:'roleMismatch'});});
for (const [status,code] of [[401,'unauthorized'],[429,'rateLimit'],[200,'malformed']] as const) test(`HTTP ${status}`,async()=>{await assert.rejects(requester(body(),status)(),{code});});
test('deadline even when fetch ignores abort',async()=>{const request=createPairingRequester(()=>new Promise(()=>{}),'');await assert.rejects(request({timeoutMs:5}),{code:'timeout'});});
test('external abort even when fetch ignores abort',async()=>{const c=new AbortController();const request=createPairingRequester(()=>new Promise(()=>{}),'');const result=request({signal:c.signal});c.abort();await assert.rejects(result,{code:'aborted'});});
test('deadline includes response body',async()=>{const request=createPairingRequester(async()=>({status:201,json:()=>new Promise(()=>{})} as Response),'');await assert.rejects(request({timeoutMs:5}),{code:'timeout'});});

test('request URL uses configured API base', async()=>{
 const request=createPairingRequester(async(url)=>{assert.equal(url,'https://api.example.test/api/auth/link-token');return new Response(JSON.stringify(body()),{status:201});},'https://api.example.test/');
 await request();
});
test('network error is classified',async()=>{await assert.rejects(createPairingRequester(async()=>{throw new TypeError('offline');},'')(),{code:'network'});});
test('invalid JSON is classified',async()=>{await assert.rejects(createPairingRequester(async()=>new Response('bad',{status:201}),'')(),{code:'malformed'});});
test('already aborted signal does not start fetch',async()=>{const c=new AbortController();c.abort();await assert.rejects(createPairingRequester(async()=>{assert.fail('must not fetch');},'')({signal:c.signal}),{code:'aborted'});});
test('late response after abort never normalizes',async()=>{
 let resolve!: (response:Response)=>void;
 const request=createPairingRequester(()=>new Promise<Response>(r=>{resolve=r;}),'');const c=new AbortController();const pending=request({signal:c.signal});c.abort();await assert.rejects(pending,{code:'aborted'});resolve(new Response(JSON.stringify(body()),{status:201}));
});

import { messages } from '../src/i18n/messages.ts';
test('all API and clipboard outcomes have EN/FR copy',()=>{
 for (const locale of ['en','fr'] as const) {
  for (const code of ['timeout','unauthorized','rateLimit','malformed','roleMismatch','network','aborted'] as const) assert.ok(messages[locale].pairing.errors[code].length > 0);
  assert.ok(messages[locale].pairing.manual.length > 0);
 }
});
