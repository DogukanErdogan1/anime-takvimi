import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {AVATAR_FRAMES} from '../lib/avatar-frames.mjs';
import {AVATAR_FRAME_GEOMETRY} from '../lib/avatar-frame-geometry.mjs';

// Read the real transparent artwork, so these regression fixtures describe
// painted pixels and open photo space rather than copying the crop constants.
function readAtlas() {
  const bytes=readFileSync(new URL('../public/site/assets/avatar-frames-v1.png',import.meta.url));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let width,height;const chunks=[];
  for(let offset=8;offset<bytes.length;){
    const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)],[8,6,0,0,0],'the fixture atlas uses non-interlaced 8-bit RGBA');
    }
    if(type==='IDAT')chunks.push(data);
    offset+=length+12;
    if(type==='IEND')break;
  }
  const stride=width*4,filtered=inflateSync(Buffer.concat(chunks)),pixels=Buffer.alloc(width*height*4);
  const paeth=(left,up,corner)=>{
    const prediction=left+up-corner,a=Math.abs(prediction-left),b=Math.abs(prediction-up),c=Math.abs(prediction-corner);
    return a<=b&&a<=c?left:b<=c?up:corner;
  };
  assert.equal(filtered.length,(stride+1)*height);
  for(let y=0;y<height;y++){
    const row=y*stride,source=y*(stride+1),filter=filtered[source];
    assert.ok(filter<=4,'a supported PNG scanline filter is used');
    for(let x=0;x<stride;x++){
      const left=x>=4?pixels[row+x-4]:0,up=y?pixels[row+x-stride]:0,corner=y&&x>=4?pixels[row+x-stride-4]:0;
      const predictor=[0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter];
      pixels[row+x]=(filtered[source+x+1]+predictor)&255;
    }
  }
  return {width,height,alpha(x,y){return pixels[(y*width+x)*4+3];},pixel([x,y]){const offset=(y*width+x)*4;return [...pixels.subarray(offset,offset+4)];}};
}

const atlas=readAtlas();
const includes=(crop,[x,y])=>x>=crop[0]&&y>=crop[1]&&x<crop[0]+crop[2]&&y<crop[1]+crop[3];

function measureOpenPhotoSpace({crop,aperture:[cx,cy]}){
  const seen=new Uint8Array(atlas.width*atlas.height),queue=new Uint32Array(seen.length);
  let count=0,head=0,maxDistance=0,outsideCrop=false;
  const add=(x,y)=>{
    const index=y*atlas.width+x;
    if(!seen[index]&&atlas.alpha(x,y)<32){seen[index]=1;queue[count++]=index;}
  };
  assert.ok(atlas.alpha(Math.round(cx),Math.round(cy))<32,'the measured avatar center is open photo space');
  add(Math.round(cx),Math.round(cy));
  while(head<count){
    const index=queue[head++],x=index%atlas.width,y=Math.floor(index/atlas.width);
    maxDistance=Math.max(maxDistance,Math.hypot(x-cx,y-cy));
    outsideCrop ||= !includes(crop,[x,y]);
    if(x>0)add(x-1,y);if(x+1<atlas.width)add(x+1,y);
    if(y>0)add(x,y-1);if(y+1<atlas.height)add(x,y+1);
  }
  return {count,maxDistance,outsideCrop};
}

test('every selectable ornament has a complete, bounded crop and a centered photo aperture',()=>{
  assert.deepEqual(Object.keys(AVATAR_FRAME_GEOMETRY).sort(),AVATAR_FRAMES.map(frame=>frame.id).sort());
  for(const {id} of AVATAR_FRAMES){
    const {crop,aperture}=AVATAR_FRAME_GEOMETRY[id];
    assert.equal(crop.length,4,id);assert.equal(aperture.length,3,id);
    assert.ok([...crop,...aperture].every(Number.isFinite),id);
    const [x,y,width,height]=crop,[cx,cy,radius]=aperture;
    assert.ok(x>=0&&y>=0&&width>0&&height>0&&x+width<=atlas.width&&y+height<=atlas.height,`${id} crop stays inside the fixed atlas`);
    assert.ok(radius>0&&includes(crop,[cx,cy]),`${id} has its photo center inside its own ornament`);
  }
});

test('Mürekkep retains its brush ring while excluding the next row’s gold laurel leaves',()=>{
  const {crop}=AVATAR_FRAME_GEOMETRY.murekkep;
  const brush=[[170,381],[170,665],[30,530],[325,530]];
  for(const point of brush){
    const [r,g,b,alpha]=atlas.pixel(point);
    assert.ok(alpha>240&&r>240&&g>240&&b>240,`${point} is actual white brush artwork`);
    assert.ok(includes(crop,point),`${point} must remain in the Mürekkep ornament`);
  }
  for(const point of [[125,711],[244,709]]){
    const [r,g,b,alpha]=atlas.pixel(point);
    assert.ok(alpha>240&&r>g&&g>b,`${point} is actual gold paint from the lower Defne ornament`);
    assert.equal(includes(crop,point),false,`${point} must not appear below Mürekkep`);
  }
});

test('Koi photo covers the open aperture rather than only its largest inscribed circle',()=>{
  const {crop,aperture:[cx,cy,radius]}=AVATAR_FRAME_GEOMETRY.koi;
  // These open pixels are visibly inside the surrounding koi/water ring.
  // The old radius of 101 atlas pixels left these edge regions empty.
  const openEdges=[[1008,808],[990,778],[936,744],[950,748],[911,739],[914,967]];
  for(const point of openEdges){
    assert.ok(atlas.pixel(point)[3]<=2,`${point} is transparent photo space in the original artwork`);
    assert.ok(includes(crop,point),`${point} belongs to the Koi crop`);
    assert.ok(Math.hypot(point[0]-cx,point[1]-cy)<=radius-1,`${point} needs a photo pixel beneath it, with an antialiasing margin`);
  }
  for(const point of [[914,718],[1040,870],[876,725],[995,963]]){
    assert.ok(atlas.pixel(point)[3]>240,`${point} is actual koi or water artwork`);
    assert.ok(includes(crop,point),`${point} must not be clipped to hide the photo gap`);
  }
});

test('every enclosed transparent photo opening is fully backed by the circular avatar',()=>{
  for(const {id} of AVATAR_FRAMES){
    if(id==='defne')continue; // This intentionally open wreath has no enclosed aperture.
    const geometry=AVATAR_FRAME_GEOMETRY[id],hole=measureOpenPhotoSpace(geometry);
    assert.ok(hole.count>20_000,`${id} measures its photo opening rather than a small transparent ornament detail`);
    assert.equal(hole.outsideCrop,false,`${id} photo opening is enclosed by its own complete ornament`);
    assert.ok(hole.maxDistance<=geometry.aperture[2]-1,`${id} has photo coverage across the entire transparent opening, with an antialiasing margin`);
  }
});
