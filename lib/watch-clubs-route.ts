import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {createWatchClubService} from './watch-clubs.mjs';
export async function watchClubContext(){return {identity:await getChatGPTUser(),service:createWatchClubService(env.DB)};}
