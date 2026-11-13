'use client';
import Link from 'next/link';
import {useState} from 'react';
import {Link as LinkIcon,Check} from 'lucide-react';
export default function ShareAnime({malId}:{malId:number}){const [message,setMessage]=useState('');return <div className="at-sharing"><button type="button" className="at-outline-button" onClick={async()=>{try{await navigator.clipboard.writeText(new URL('/anime/'+malId,location.origin).href);setMessage('Bağlantı kopyalandı.');}catch{setMessage('Bağlantıyı aşağıdan kopyalayabilirsin.');}}}>{message.startsWith('Bağlantı kopyalandı')?<Check size={15}/>:<LinkIcon size={15}/>}Paylaş</button><Link href={'/anime/'+malId}>Anime bağlantısı</Link>{message&&<small role="status">{message}</small>}</div>;}
