import {normalizeAvatarFrame} from '../../lib/avatar-frames.mjs';
import {AVATAR_FRAME_GEOMETRY} from '../../lib/avatar-frame-geometry.mjs';

/** Transparent frame artwork leaves the account's own photo visible underneath. */
export function AvatarFrame({frameId,className=''}:{frameId?:string|null;className?:string}) {
  const id=normalizeAvatarFrame(frameId);
  if(id==='none')return null;
  const geometry=AVATAR_FRAME_GEOMETRY[id];
  if(!geometry)return null;
  const [x,y,radius]=geometry.aperture;
  const [left,top,width,height]=geometry.crop;
  return <span className={'at-avatar-frame '+className} data-frame-id={id} aria-hidden="true">
    <svg viewBox={`${x-radius} ${y-radius} ${radius*2} ${radius*2}`} focusable="false" aria-hidden="true">
      <svg x={left} y={top} width={width} height={height} viewBox={`${left} ${top} ${width} ${height}`} overflow="hidden">
        <image href="/site/assets/avatar-frames-v1.png" x="0" y="0" width="1448" height="1086"/>
      </svg>
    </svg>
  </span>;
}
