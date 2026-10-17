import type {Anime, Library, WatchStatus} from './types';

export const statuses: {id:WatchStatus;label:string}[] = [
  {id:'watching',label:'İzliyorum'},{id:'planned',label:'İzleyeceğim'},
  {id:'completed',label:'Tamamladım'},{id:'dropped',label:'Bıraktım'},
];
export function watchStatus(item:Anime, library:Library):WatchStatus {
  if (library.tracking[item.id]) return library.tracking[item.id];
  const count = library.progress[item.id] || 0;
  return item.episodes && count >= item.episodes ? 'completed' : count > 0 ? 'watching' : 'planned';
}
export function recommendations(catalog:Anime[], library:Library, limit=4) {
  const genres = new Map<string,number>();
  for (const id of new Set([...library.saved,...library.favorites])) {
    const item = library.savedAnime[id];
    if (!item || library.tracking[id] === 'dropped') continue;
    for (const genre of item.genres) genres.set(genre,(genres.get(genre)||0)+(library.favorites.includes(id)?2:1));
  }
  const excluded = new Set([...library.saved,...Object.keys(library.tracking)]);
  const seen = new Set<string>();
  return catalog.filter(item => {if(excluded.has(item.id)||seen.has(item.id))return false;seen.add(item.id);return true;})
    .map(item => ({item,affinity:item.genres.reduce((sum,genre)=>sum+(genres.get(genre)||0),0)}))
    .sort((a,b)=>b.affinity-a.affinity||b.item.members-a.item.members||(b.item.rating||0)-(a.item.rating||0))
    .slice(0,limit).map(({item,affinity})=>({item,reason:affinity>0?item.genres.find(genre=>genres.has(genre))||null:null}));
}
export function advanceEpisode(item:Anime, library:Library):Partial<Library> {
  const next = Math.min(item.episodes||9999,(library.progress[item.id]||0)+1);
  return {saved:[...new Set([...library.saved,item.id])],savedAnime:{...library.savedAnime,[item.id]:item},
    progress:{...library.progress,[item.id]:next},
    tracking:{...library.tracking,[item.id]:item.episodes&&next>=item.episodes?'completed':'watching'}};
}
