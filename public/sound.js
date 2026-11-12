// Quiet, generated effects: no downloads, autoplay, or background music.
const button = document.getElementById('sound');
const Audio = window.AudioContext || window.webkitAudioContext;
let enabled = true, available = !!Audio, context = null, master = null, noise = null, epoch = 0;
const active = new Set();
try { enabled = localStorage.getItem('minefield-sound') !== 'off'; } catch {}
function updateButton() {
  button.textContent = available ? `Sound: ${enabled ? 'on' : 'off'}` : 'Sound unavailable';
  button.disabled = !available;
  button.setAttribute('aria-pressed', String(enabled && available));
  button.setAttribute('aria-label', enabled && available ? 'Mute sound' : 'Enable sound');
}
function unlock() {
  if (!enabled || !available) return;
  try {
    if (!context) {
      context = new Audio(); master = context.createGain();
      master.gain.value = .12; master.connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch { available = false; updateButton(); }
}
function stop() {
  epoch++;
  for (const node of active) { try { node.stop(); } catch {} }
  active.clear();
}
function track(node, cleanup = []) {
  active.add(node);
  node.onended = () => { active.delete(node); node.disconnect(); for (const part of cleanup) part.disconnect(); };
}
function tone(frequency, at, duration = .07, peak = .3, endFrequency = frequency) {
  if (active.size >= 16) return;
  const oscillator = context.createOscillator(), envelope = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, at);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
  envelope.gain.setValueAtTime(.0001, at);
  envelope.gain.linearRampToValueAtTime(peak, at + .005);
  envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
  oscillator.connect(envelope); envelope.connect(master); track(oscillator, [envelope]);
  oscillator.start(at); oscillator.stop(at + duration + .01);
}
function explosion(at) {
  if (!noise) {
    noise = context.createBuffer(1, Math.ceil(context.sampleRate * .28), context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
  source.buffer = noise; filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, at); filter.frequency.exponentialRampToValueAtTime(90, at + .26);
  envelope.gain.setValueAtTime(.0001, at); envelope.gain.linearRampToValueAtTime(.45, at + .008);
  envelope.gain.exponentialRampToValueAtTime(.0001, at + .27);
  source.connect(filter); filter.connect(envelope); envelope.connect(master); track(source, [filter, envelope]);
  source.start(at); source.stop(at + .28);
  tone(100, at, .23, .35, 40);
}
function play(effect, delay = 0) {
  if (!enabled || !available || !context || document.hidden) return;
  const generation = epoch;
  const run = () => {
    if (!enabled || document.hidden || generation !== epoch || context.state !== 'running') return;
    if (active.size >= 16) return;
    const at = context.currentTime + delay;
    try {
      switch (effect) {
        case 'reveal': tone(660, at, .045, .2); break;
        case 'flag': tone(500, at, .06, .25, 800); break;
        case 'unflag': tone(800, at, .06, .25, 420); break;
        case 'chord': tone(480, at, .05); tone(720, at + .035, .07); break;
        case 'tick': tone(420, at, .04, .15); break;
        case 'start': tone(660, at, .06); tone(990, at + .07, .1); break;
        case 'explode': explosion(at); break;
        case 'win': [523, 659, 784, 1047].forEach((hz, i) => tone(hz, at + i * .09, .14)); break;
        case 'lose': [300, 220, 160].forEach((hz, i) => tone(hz, at + i * .09, .14)); break;
        case 'draw': tone(440, at, .08); tone(440, at + .12, .08); break;
      }
    } catch { /* Audio support never blocks a game action. */ }
  };
  if (context.state === 'suspended') void context.resume().then(run).catch(() => {});
  else run();
}
button.addEventListener('click', () => {
  enabled = !enabled;
  try { localStorage.setItem('minefield-sound', enabled ? 'on' : 'off'); } catch {}
  stop();
  if (master) master.gain.setValueAtTime(enabled ? .12 : 0, context.currentTime);
  updateButton();
  if (enabled) { unlock(); play('flag'); }
});
window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
window.addEventListener('keydown', unlock, { capture: true });
window.addEventListener('blur', stop);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
updateButton();
export const sound = { play, stop };
