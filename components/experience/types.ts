export type WatchStatus = 'watching' | 'planned' | 'completed' | 'dropped';
export type Anime = {
  id: string; malId: number; title: string; original?: string; synonyms?: string[]; image: string | null;
  genres: string[]; episodes: number | null; rating: number | null; studio: string;
  summary: string; malUrl: string | null; format: string; members: number;
  day: number | null; time: string | null; broadcastLocal: boolean; airing: boolean;
  status: string; duration?: number | null; durationText?: string; year?: number | null;
  season?: string | null; airedFrom?: string | null; broadcastSource?: string | null;
};
export type Collection = {id: string; title: string; animeIds: string[]};
export type Activity = {id:string;animeId:string;title:string;at:number;from:number;to:number};
export type HomeWidget='continue'|'recommendations'|'today'|'history';
export type HomeLayout={order:HomeWidget[];hidden:HomeWidget[];weeklyGoal:number};
export type Library = {
  saved: string[]; reminders: string[]; progress: Record<string, number>;
  view: 'grid' | 'list'; savedAnime: Record<string, Anime>;
  tracking: Record<string, WatchStatus>; scores: Record<string, number>;
  favorites: string[]; collections: Collection[];
  activity?:Activity[]; homeLayout?:HomeLayout; episodeNotes?:Record<string,Record<string,string>>;
};
export type Account = {
  authenticated: boolean; registered: boolean;
  user?: {id: string; displayName: string; email?: string; role: 'admin'|'member'; status: 'active'|'suspended'; avatarUrl?: string|null; avatarFrame?:string|null; createdAt?: string};
};
export type ExperienceSnapshot = {
  ready: boolean; page: string; catalog: Anime[]; schedule: Anime[];
  library: Library; account: Account | null; accountScope: string | null;
  loading: boolean; error: string | null; libraryLoading: boolean; blocked: boolean;
};
export type LibraryChange = (patch: Partial<Library> | ((current: Library) => Partial<Library>),options?:{recordActivity?:boolean}) => void;
export type Snapshot = ExperienceSnapshot;
export type AnimeDetails = {trailerUrl: string|null; relations: {id:number;title:string;url:string;relation?:string}[]};
declare global {
  interface Window {
    AnimeExperienceMounted?: boolean;
    animeTakvimi?: {
      getState: () => {page:string; accountScope:string|null; [key:string]: unknown};
      getLibrarySnapshot: () => Library;
      getExperienceSnapshot: () => Omit<ExperienceSnapshot,'ready'|'account'|'libraryLoading'|'blocked'>;
      replaceLibrarySnapshot: (value: Library, options?: {emit?:boolean;recordActivity?:boolean}) => void;
      registerItems: (items: Anime[]) => void;
      openDetail: (id:string) => void;
      navigate: (page:string) => void;
      loadSchedule: () => Promise<void>;
      getAnime: (id:string) => Anime|undefined;
      undoLibraryChange: () => boolean;
      setAdvancedFilters: (value:Record<string,unknown>) => void;
      clearCatalogFilters: () => void;
      getCatalogContext: () => {filters:{genres:string[];mode:string;minRating:number;minEpisodes:number;maxEpisodes:number;studio:string;status:string};genres:string[];studios:string[]};
    };
    AnimeMembership?: {
      getAccount: () => Account|null;
      getStatus: () => {authenticated:boolean; registered:boolean; role:string|null; scopeUserId:string|null; saving:boolean; pending:boolean; libraryLoading:boolean; blocked:boolean};
      openProfile: () => void; openSettings: () => void; closeAdmin: () => void; isAdminOpen: () => boolean;
    };
    AnimeData?: {
      safeImage: (value:unknown) => string|null;
      searchAnime: (query:string,options?:{signal?:AbortSignal}) => Promise<{anime:Anime[];fetchedAt:number;cached:boolean;source:string}>;
      getDetails: (malId:number,options?:{signal?:AbortSignal}) => Promise<AnimeDetails>;
    };
    AnimeBanners?: {resolve: (id:number) => Promise<string|null>; safeBanner: (value:unknown,id?:number) => string|null; resolvePoster: (id:number) => Promise<string|null>; safePoster: (value:unknown) => string|null};
  }
}
