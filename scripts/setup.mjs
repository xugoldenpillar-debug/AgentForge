import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if(existsSync('.env')) {console.log('.env already exists; no secrets were overwritten.');}
else {const template=readFileSync('.env.example','utf8').replace('replace-with-at-least-32-random-characters',randomBytes(48).toString('base64url')).replace('replace-with-base64-encoded-32-byte-key',randomBytes(32).toString('base64'));writeFileSync('.env',template,{mode:0o600});console.log('Created .env with unique encryption and authentication keys.');}
