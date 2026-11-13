import * as webpush from 'web-push';
import {createECDH} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export function loadPushKeys(path, environment = process.env) {
  let keys;
  if (environment.PUSH_PUBLIC_KEY || environment.PUSH_PRIVATE_KEY) {
    if (!environment.PUSH_PUBLIC_KEY || !environment.PUSH_PRIVATE_KEY) throw new Error('Both PUSH_PUBLIC_KEY and PUSH_PRIVATE_KEY are required.');
    keys = {publicKey: environment.PUSH_PUBLIC_KEY, privateKey: environment.PUSH_PRIVATE_KEY};
  } else {
    try {keys = JSON.parse(readFileSync(path, 'utf8'));}
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Stored push keys could not be read; keep the existing key file.', {cause: error});
      keys = webpush.generateVAPIDKeys();
      mkdirSync(dirname(path), {recursive: true});
      try {writeFileSync(path, JSON.stringify(keys), {mode: 0o600, flag: 'wx'});}
      catch (error) {if (error.code !== 'EEXIST') throw error; keys = JSON.parse(readFileSync(path, 'utf8'));}
    }
  }
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(keys.privateKey, 'base64url'));
    if (ecdh.getPublicKey().toString('base64url') !== keys.publicKey) throw new Error('Key mismatch');
  } catch {throw new Error('Push keys are invalid. Restore the correct existing key pair.');}
  const subject = environment.PUSH_SUBJECT || environment.APP_PUBLIC_URL || 'https://anime-takvimi-production.up.railway.app';
  if (!/^(?:https?:\/\/|mailto:)/.test(subject)) throw new Error('PUSH_SUBJECT must be a public URL or mailto address.');
  return {...keys, subject};
}
