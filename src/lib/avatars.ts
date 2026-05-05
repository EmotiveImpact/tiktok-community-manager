const GRADIENTS = [
  'avatar-gradient-pink',
  'avatar-gradient-blue',
  'avatar-gradient-purple',
  'avatar-gradient-emerald',
  'avatar-gradient-amber',
  'avatar-gradient-orange',
  'avatar-gradient-cyan',
  'avatar-gradient-rose',
];

export function avatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}
