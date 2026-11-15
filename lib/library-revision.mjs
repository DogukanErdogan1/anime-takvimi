export function stableJson(value){
 if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export async function libraryRevision(library){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(library)))),b=>b.toString(16).padStart(2,'0')).join('');}
