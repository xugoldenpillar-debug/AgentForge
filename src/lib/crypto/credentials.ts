import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors.ts';
export function encryptionKey(encoded:string):Buffer {
  const key=Buffer.from(encoded,'base64');
  if(key.length!==32||key.toString('base64')!==encoded)throw new AppError('Credential encryption is not configured. Set a valid 32-byte base64 key.',503);
  return key;
}
export function encryptCredential(plaintext:string,encodedKey:string,ownerId:string,credentialId:string):string {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(encodedKey),iv);
  cipher.setAAD(Buffer.from(`agentforge:v1:${ownerId}:${credentialId}`));
  const ciphertext=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
}
export function decryptCredential(ciphertext:string,encodedKey:string,ownerId:string,credentialId:string):string {
  try {
    const [v,iv,tag,data,...rest]=ciphertext.split('.');if(v!=='v1'||!iv||!tag||!data||rest.length)throw new Error();
    const decipher=createDecipheriv('aes-256-gcm',encryptionKey(encodedKey),Buffer.from(iv,'base64url'));
    decipher.setAAD(Buffer.from(`agentforge:v1:${ownerId}:${credentialId}`));decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8');
  }catch{throw new AppError('Credential could not be decrypted. Delete it and add it again.',503);}
}
export function maskKey(lastFour:string):string {return `sk-****${lastFour.slice(-4).replace(/[^a-zA-Z0-9_-]/g,'*')}`;}
