// Browser glue only. All mine generation, reveals, flags, chording and win rules are Rust.
const response = await fetch('/minefield.wasm');
if (!response.ok) throw Error('Could not load the game engine. Run ./scripts/build.sh, then refresh.');
const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {
  env: {
    random_u32: () => crypto.getRandomValues(new Uint32Array(1))[0],
    now_ms: () => Date.now(),
    report_panic: (ptr, len) => console.error(new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, ptr, len)))
  }
});
const engine = instance.exports, encoder = new TextEncoder(), decoder = new TextDecoder();
function call(input) {
  const bytes = encoder.encode(JSON.stringify(input)), ptr = engine.allocate(bytes.length);
  new Uint8Array(engine.memory.buffer, ptr, bytes.length).set(bytes);
  let output;
  try { output = engine.execute(ptr, bytes.length); }
  finally { engine.release(ptr, bytes.length); }
  const outPtr = Number(output & 0xffffffffn), length = Number(output >> 32n);
  let result;
  try { result = JSON.parse(decoder.decode(new Uint8Array(engine.memory.buffer, outPtr, length))); }
  finally { engine.release(outPtr, length); }
  if (result.error) throw Error(result.error);
  return result.ok;
}
export const PRESETS = {
  easy: { width: 9, height: 9, mines: 10 },
  medium: { width: 16, height: 16, mines: 40 },
  hard: { width: 30, height: 16, mines: 99 }
};
export const create = input => call({ op: 'create', input });
export function act(room, id, input) { Object.assign(room, call({ op: 'act', room, id, input })); }
export const view = (room, id) => call({ op: 'view', room, id });
