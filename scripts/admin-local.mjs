// Trusted local operator setup. Never promotes by an unverified email address.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { projectRoot } from './sites-env.mjs';

if (!stdin.isTTY) throw Error('Yönetici kurulumu için bu komutu kendi terminalinde çalıştır.');
const prompt = createInterface({input:stdin, output:stdout});
let db;
try {
  const id = String(process.argv[2] || await prompt.question('Kendi Profilim → Hesap ayarları ekranındaki hesap kimliğini yapıştır: ')).trim();
  if (!/^acct-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw Error('Geçerli bir hesap kimliği gir. E-posta adresi kullanma.');
  const directory=join(projectRoot,'.wrangler','state','v3','d1','miniflare-D1DatabaseObject');
  for (const name of readdirSync(directory).filter(name=>/^[0-9a-f]{64}\.sqlite$/.test(name))) {
    const candidate=new DatabaseSync(join(directory,name));
    try {
      const member=candidate.prepare('SELECT m.id,m.email,m.display_name FROM members m JOIN auth_accounts a ON a.user_id=m.id WHERE m.id=? AND m.status=\'active\'').get(id);
      if(member){ if(db){candidate.close();throw Error('Hesap birden fazla yerel veritabanında bulundu.');} db=candidate; }
      else candidate.close();
    }catch(error){if(candidate!==db)try{candidate.close();}catch{} if(!/no such table/.test(error.message))throw error;}
  }
  if(!db)throw Error('Bu hesap bulunamadı. Önce localhost sitesinde kendi hesabını oluştur.');
  const member=db.prepare('SELECT email,display_name FROM members WHERE id=?').get(id);
  console.log(`Hesap: ${member.display_name} (${member.email})\nKimlik: ${id}`);
  if((await prompt.question('Bu kimliği kendi giriş yaptığın hesabından kopyaladıysan EVET yaz: ')).trim()!=='EVET')throw Error('Kurulum iptal edildi.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const active=db.prepare("SELECT m.id FROM members m JOIN auth_accounts a ON a.user_id=m.id WHERE m.id=? AND m.status='active'").get(id);
    if(!active)throw Error('Hesap artık aktif değil. Kurulum yapılmadı.');
    const owner=db.prepare("SELECT value FROM app_settings WHERE key='admin_owner'").get();
    if(owner&&owner.value!==id)throw Error('Bu veritabanının zaten başka bir yöneticisi var. Sahiplik otomatik değiştirilemez.');
    db.prepare("INSERT INTO app_settings(key,value) VALUES('admin_owner',?) ON CONFLICT(key) DO NOTHING").run(id);
    const updated=db.prepare("UPDATE members SET role='admin' WHERE id=? AND status='active'").run(id);
    if(Number(updated.changes)!==1)throw Error('Hesap güncellenemedi. Kurulum yapılmadı.');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log('Yönetici hesabı hazır. Siteyi yenileyerek Yönetim menüsünü açabilirsin.');
} finally {db?.close();prompt.close();}
