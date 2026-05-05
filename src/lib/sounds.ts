let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration);
  } catch {}
}

export function playGiftSound() {
  playTone(880, 0.15, 'sine', 0.12);
  setTimeout(() => playTone(1100, 0.2, 'sine', 0.1), 100);
  setTimeout(() => playTone(1320, 0.3, 'sine', 0.08), 200);
}

export function playFollowSound() {
  playTone(660, 0.12, 'triangle', 0.1);
  setTimeout(() => playTone(880, 0.15, 'triangle', 0.08), 80);
}

export function playKeywordSound() {
  playTone(520, 0.1, 'square', 0.06);
  setTimeout(() => playTone(650, 0.15, 'square', 0.05), 100);
}

export function playMilestoneSound() {
  playTone(440, 0.1, 'sine', 0.12);
  setTimeout(() => playTone(660, 0.1, 'sine', 0.1), 100);
  setTimeout(() => playTone(880, 0.1, 'sine', 0.1), 200);
  setTimeout(() => playTone(1100, 0.3, 'sine', 0.08), 300);
}
