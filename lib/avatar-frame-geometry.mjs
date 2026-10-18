// Bounds are measured from the artwork, which does not follow an even tile grid.
// Aperture circles cover the entire transparent interior plus a small overlap
// under the ornament, so the photo does not leave a dark seam at its edge.
export const AVATAR_FRAME_GEOMETRY = Object.freeze(Object.fromEntries([
  ['platin',       [0,0,350,350],        [187,195,138]],
  ['yorunge',      [350,0,392,350],      [548,190,134]],
  ['editor',       [742,0,344,357],      [902,192,133]],
  ['kirik-halo',   [1086,0,362,357],     [1266,186,132]],
  ['murekkep',     [0,350,362,342],      [183,524,125]],
  ['panel',        [362,350,374,330],    [546,525,131]],
  ['kristal',      [736,357,350,330],    [907,526,126]],
  ['krom-akis',    [1086,357,362,319],   [1255,519,128]],
  ['defne',        [0,692,365,340],      [190,844,136]],
  ['krizantem',    [370,685,351,351],    [545,851,119]],
  ['koi',          [731,687,346,345],    [905,857,127]],
  ['yildiz-muhru', [1090,674,358,366],   [1262,852,122]],
].map(([id,crop,aperture])=>[id,Object.freeze({crop:Object.freeze(crop),aperture:Object.freeze(aperture)})])));
