export const THEMES = [
  {id:'porselen',name:'Porselen',mode:'light',description:'Serin beyaz yüzeyler ve kobalt mavisi.',colors:{paper:'#f4f6fb',surface:'#ffffff',ink:'#182a46',muted:'#586781',line:'#d3ddeb',accent:'#2455c7',accentHover:'#1943a4',onAccent:'#ffffff',sage:'#8db3ee',nav:'#152643'}},
  {id:'gece',name:'Gece Yarısı',mode:'dark',description:'Derin lacivert ve elektrik mavisi.',colors:{paper:'#0c1730',surface:'#152444',ink:'#eaf1ff',muted:'#a5b7d8',line:'#304668',accent:'#83b6ff',accentHover:'#a2caff',onAccent:'#10203a',sage:'#526cc4',nav:'#0a1327'}},
  {id:'nar',name:'Nar',mode:'dark',description:'Bordo yüzeyler ve mercan kırmızısı.',colors:{paper:'#28141d',surface:'#3a2029',ink:'#ffedf0',muted:'#d3a7b4',line:'#65404a',accent:'#ff9b91',accentHover:'#ffb7ae',onAccent:'#39151c',sage:'#ca5678',nav:'#30131d'}},
  {id:'buzul',name:'Buzul',mode:'light',description:'Buz mavisi yüzeyler ve petrol mavisi ayrıntılar.',colors:{paper:'#edf7fa',surface:'#f8fdff',ink:'#143845',muted:'#4f6c77',line:'#c6dfe7',accent:'#08687c',accentHover:'#054e60',onAccent:'#ffffff',sage:'#7ccbd6',nav:'#0d2b37'}},
  {id:'ada',name:'Ada',mode:'dark',description:'Koyu orman yeşili ve ferah nane vurguları.',colors:{paper:'#0d2520',surface:'#173b32',ink:'#e4f7ee',muted:'#a4c6b6',line:'#355e50',accent:'#8de2b4',accentHover:'#b1eccd',onAccent:'#113b29',sage:'#3aa796',nav:'#0c2b23'}},
  {id:'kumtasi',name:'Kumtaşı',mode:'light',description:'Sıcak taş rengi ve kiremit vurguları.',colors:{paper:'#f5eee5',surface:'#fffaf3',ink:'#443229',muted:'#78614f',line:'#dfcdbc',accent:'#a0472f',accentHover:'#803620',onAccent:'#ffffff',sage:'#d3a283',nav:'#3d281f'}},
  {id:'volt',name:'Volt',mode:'dark',description:'Koyu zeytin tonları ve canlı limon sarısı.',colors:{paper:'#171c14',surface:'#242d1c',ink:'#f2f6e9',muted:'#b5c2a1',line:'#4a5936',accent:'#d4ef60',accentHover:'#e4ff83',onAccent:'#243009',sage:'#72a95a',nav:'#161e10'}},
  {id:'orkide',name:'Orkide',mode:'light',description:'Pudra pembe yüzeyler ve orkide moru.',colors:{paper:'#fcf2f7',surface:'#fffafd',ink:'#46243c',muted:'#7b596e',line:'#e7ccdd',accent:'#963a77',accentHover:'#7b285f',onAccent:'#ffffff',sage:'#dca3ce',nav:'#3c1c34'}},
] as const;

export type ThemeId = typeof THEMES[number]['id'];
export const THEME_KEY = 'anime-takvimi-palette-v1';
export const LEGACY_THEME_KEY = 'anime-takvimi-theme-v1';
export const THEME_EVENT = 'anime:themechange';

function isTheme(value:unknown):value is ThemeId {
  return typeof value==='string'&&THEMES.some(theme=>theme.id===value);
}

// Preserve a saved selection when refreshing the available palettes.
const previousPalettes:Record<string,ThemeId>={hikari:'porselen',yoru:'gece',yozakura:'nar',matcha:'buzul',shinkai:'ada',kitsune:'volt',kurogane:'gece',tanpopo:'kumtasi'};

function savedTheme(value:unknown):ThemeId|undefined {
  if(isTheme(value))return value;
  return typeof value==='string'&&Object.hasOwn(previousPalettes,value)?previousPalettes[value]:undefined;
}

export function readThemePreference():ThemeId {
  if(typeof window==='undefined')return 'porselen';
  try {
    const saved=savedTheme(window.localStorage.getItem(THEME_KEY));
    if(saved)return saved;
    const legacy=window.localStorage.getItem(LEGACY_THEME_KEY);
    if(legacy==='dark')return 'gece';
    if(legacy==='light')return 'porselen';
  } catch { /* A blocked store must not prevent changing the current page. */ }
  try {return window.matchMedia('(prefers-color-scheme: dark)').matches?'gece':'porselen';}
  catch {return 'porselen';}
}

export function getActiveTheme():ThemeId {
  const active=typeof document==='undefined'?null:document.documentElement.dataset.palette;
  return isTheme(active)?active:readThemePreference();
}

export function applyTheme(id:ThemeId,persist=true):void {
  const theme=THEMES.find(item=>item.id===id);
  if(!theme||typeof document==='undefined')return;
  const root=document.documentElement,colors=theme.colors;
  root.dataset.palette=theme.id;
  root.dataset.theme=theme.mode;
  root.style.colorScheme=theme.mode;
  const variables={
    '--paper':colors.paper,'--theme-surface':colors.surface,'--surface':colors.surface,
    '--ink':colors.ink,'--muted':colors.muted,'--line':colors.line,
    '--coral':colors.accent,'--coral-dark':colors.accentHover,
    '--theme-on-accent':colors.onAccent,'--on-accent':colors.onAccent,
    '--sage':colors.sage,'--theme-nav':colors.nav,
  };
  for(const [key,value] of Object.entries(variables))root.style.setProperty(key,value);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content',colors.nav);
  if(persist){
    try {
      window.localStorage.setItem(THEME_KEY,theme.id);
      window.localStorage.setItem(LEGACY_THEME_KEY,theme.mode);
    } catch { /* The selected palette still works for this visit. */ }
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT,{detail:{id:theme.id}}));
}
