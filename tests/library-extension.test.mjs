import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLibrary, MembershipError } from '../lib/membership.mjs';
const base = () => ({saved:[],reminders:[],progress:{},view:'grid',savedAnime:{}});
const validate = values => validateLibrary({library:{...base(),...values}});

test('older library requests retain their exact shape while new fields round-trip independently', () => {
  assert.deepEqual(validateLibrary({library:base()}),base());
  const extras = {tracking:{'mal-1':'watching','mal-2':'planned','mal-3':'completed','mal-4':'dropped'},scores:{'mal-1':10},favorites:['mal-1'],collections:[{id:'first-collection',title:'İlk koleksiyonum',animeIds:['mal-1','mal-2']}]};
  assert.deepEqual(validate(extras),{...base(),...extras});
  assert.deepEqual(validate({favorites:[]}),{...base(),favorites:[]});
  assert.deepEqual(validate({collections:[{id:'one',title:' A ',animeIds:['mal-1','mal-1']}]}).collections,[{id:'one',title:'A',animeIds:['mal-1']}]);
});

test('new library values reject unknown statuses, invalid scores, unsafe collection IDs and privilege fields', () => {
  for(const extras of [{tracking:[]},{tracking:{'mal-1':'admin'}},{tracking:{'bad':'watching'}},{scores:{'mal-1':0}},{scores:{'mal-1':11}},{scores:{'mal-1':1.5}},{favorites:['mal-0']},{collections:[{id:'../escape',title:'One',animeIds:[]}]},{collections:[{id:'one',title:' ',animeIds:[]}]},{collections:[{id:'one',title:'a'.repeat(61),animeIds:[]}]},{collections:[{id:'one',title:'One',animeIds:['invalid']}]},{collections:[{id:'one',title:'One',animeIds:[],owner:'other'}]},{collections:[{id:'same',title:'One',animeIds:[]},{id:'same',title:'Two',animeIds:[]}]}]) assert.throws(()=>validate(extras),MembershipError);
});

test('all optional and original library fields share the 500-anime budget and collections are bounded', () => {
  const saved = Array.from({length:500},(_,i)=>`mal-${i+1}`);
  assert.equal(validate({saved,tracking:{'mal-500':'watching'},favorites:['mal-500']}).saved.length,500);
  for(const extras of [{saved,tracking:{'mal-501':'planned'}},{saved,scores:{'mal-501':1}},{saved,favorites:['mal-501']},{saved,collections:[{id:'extra',title:'Extra',animeIds:['mal-501']}]}]) assert.throws(()=>validate(extras),MembershipError);
  assert.throws(()=>validate({collections:Array.from({length:101},(_,i)=>({id:`collection-${i}`,title:'One',animeIds:[]}))}),MembershipError);
  assert.throws(()=>validate({favorites:Array.from({length:501},()=> 'mal-1')}),MembershipError);
});

test('optional library fields cannot bypass the one-MiB stored payload limit', () => {
  const savedAnime = Object.fromEntries(Array.from({length:160},(_,i)=>[`mal-${i+1}`,{id:`mal-${i+1}`,title:'Anime',summary:'あ'.repeat(3000)}]));
  assert.throws(()=>validate({savedAnime,tracking:{'mal-1':'watching'},favorites:['mal-1']}),error=>error instanceof MembershipError && error.status===413);
});
