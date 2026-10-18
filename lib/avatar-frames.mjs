// Shared account metadata; frame artwork is rendered by the client, never stored as HTML.
export const AVATAR_FRAMES = Object.freeze([
  {id: 'platin', name: 'Platin'},
  {id: 'yorunge', name: 'Yörünge'},
  {id: 'editor', name: 'Editör'},
  {id: 'kirik-halo', name: 'Kırık Halo'},
  {id: 'murekkep', name: 'Mürekkep'},
  {id: 'panel', name: 'Panel'},
  {id: 'kristal', name: 'Kristal'},
  {id: 'krom-akis', name: 'Krom Akış'},
  {id: 'defne', name: 'Defne'},
  {id: 'krizantem', name: 'Krizantem'},
  {id: 'koi', name: 'Koi'},
  {id: 'yildiz-muhru', name: 'Yıldız Mührü'},
].map(frame => Object.freeze(frame)));

const frameIds = new Set(['none', ...AVATAR_FRAMES.map(frame => frame.id)]);
export const isAvatarFrame = value => typeof value === 'string' && frameIds.has(value);
export const normalizeAvatarFrame = value => isAvatarFrame(value) ? value : 'none';
