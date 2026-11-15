import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileDriveToken} from './drive-auth.mjs';
const scope='https://www.googleapis.com/auth/drive.readonly';
test('mobile SDK asks for read-only Drive and returns only a short-lived access token',async()=>{
 let configuration;
 const sdk={configure:value=>configuration=value,hasPlayServices:async()=>true,signIn:async()=>({type:'success',data:{scopes:[scope]}}),getTokens:async()=>({accessToken:'test-only',idToken:'not-forwarded'})};
 assert.deepEqual(await mobileDriveToken(sdk,{webClientId:'web-client'}),{access_token:'test-only',scope,expires_in:3000});
 assert.deepEqual(configuration.scopes,[scope]);assert.equal(configuration.offlineAccess,false);
 sdk.signIn=async()=>({type:'cancelled'});await assert.rejects(mobileDriveToken(sdk,{}),/cancelled/);
 sdk.signIn=async()=>({type:'success',data:{scopes:[]}});await assert.rejects(mobileDriveToken(sdk,{}),/permission/);
});
test('mobile SDK reuses existing native sign-in silently without interactive prompts',async()=>{
 let prompted=0, cleared='';
 const sdk={
  configure(){},
  hasPlayServices:async()=>true,
  hasPreviousSignIn:async()=>true,
  clearCachedAccessToken:async tok=>{cleared=tok;},
  signInSilently:async()=>({type:'success',data:{scopes:[scope]}}),
  signIn:async()=>{prompted++;return {type:'cancelled'};},
  getTokens:async()=>({accessToken:'silent-token'}),
 };
 assert.deepEqual(await mobileDriveToken(sdk,{webClientId:'web-client',clearToken:'old-tok'}),{access_token:'silent-token',scope,expires_in:3000});
 assert.equal(prompted,0);
 assert.equal(cleared,'old-tok');
 sdk.signInSilently=async()=>({type:'noSavedCredentialFound',data:null});
 await assert.rejects(mobileDriveToken(sdk,{silent:true}),/Reconnect Google Drive/);
 assert.equal(prompted,0);
});
