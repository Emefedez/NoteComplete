import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { desktopCredentials, desktopSignIn, refreshDesktopToken } from './google-auth.js';
const scope='https://www.googleapis.com/auth/drive.readonly';
const credentials={clientId:'123-desktop.apps.googleusercontent.com',clientSecret:'public-installed-client-value'};
test('desktop rejects web credential files',()=>{
 assert.throws(()=>desktopCredentials({web:{client_id:credentials.clientId}}));
 assert.equal(desktopCredentials({installed:{client_id:credentials.clientId}}).clientId,credentials.clientId);
});
test('desktop OAuth binds loopback callback to state and exchanges PKCE proof',async()=>{
 let challenge;
 const token=await desktopSignIn({credentials,openExternal:async address=>{
  const url=new URL(address);challenge=url.searchParams.get('code_challenge');
  assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),scope);
  const callback=new URL(url.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname,'127.0.0.1');
  callback.search=new URLSearchParams({state:'wrong',code:'bad'}).toString();
  assert.equal((await fetch(callback)).status,400);
  callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','test-code');
  assert.equal((await fetch(callback)).status,200);
 },fetcher:async(url,request)=>{
  assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(request.method,'POST');
  assert.equal(request.body.get('code'),'test-code');
  assert.equal(createHash('sha256').update(request.body.get('code_verifier')).digest('base64url'),challenge);
  return Response.json({access_token:'test-only',scope,expires_in:3600,refresh_token:'must-not-return'});
 }});
 assert.deepEqual(token,{access_token:'test-only',scope,expires_in:3600});
});
test('desktop cancellation closes auth without a token exchange',async()=>{
 const controller=new AbortController();let callback;
 await assert.rejects(desktopSignIn({credentials,signal:controller.signal,openExternal:async address=>{callback=new URL(address).searchParams.get('redirect_uri');controller.abort();},fetcher:()=>{throw Error('must not exchange');}}),/cancelled/);
 await assert.rejects(fetch(callback));
});
test('desktopSignIn captures refresh token via callback without exposing it, and refreshes silently',async()=>{
 let savedRefresh='';
 const token=await desktopSignIn({credentials,onRefreshToken:rt=>{savedRefresh=rt;},openExternal:async address=>{
  const url=new URL(address);
  assert.equal(url.searchParams.get('access_type'),'offline');
  const cb=new URL(url.searchParams.get('redirect_uri'));
  cb.searchParams.set('state',url.searchParams.get('state'));cb.searchParams.set('code','ok-code');
  await fetch(cb);
 },fetcher:async()=>Response.json({access_token:'first',scope,expires_in:3600,refresh_token:'rt-secret'})});
 assert.deepEqual(token,{access_token:'first',scope,expires_in:3600});
 assert.equal(savedRefresh,'rt-secret');
 const refreshed=await refreshDesktopToken({credentials,refreshToken:savedRefresh,scope,fetcher:async(url,req)=>{
  assert.equal(url,'https://oauth2.googleapis.com/token');
  assert.equal(req.body.get('grant_type'),'refresh_token');
  assert.equal(req.body.get('refresh_token'),'rt-secret');
  return Response.json({access_token:'fresh',expires_in:3500});
 }});
 assert.deepEqual(refreshed,{access_token:'fresh',scope,expires_in:3500});
 await assert.rejects(refreshDesktopToken({credentials,refreshToken:savedRefresh,scope,fetcher:async()=>Response.json({error:'invalid_grant'},{status:400})}),err=>err.code==='invalid_grant');
});
