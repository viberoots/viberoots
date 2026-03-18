export function byteLengthForArray(array: Int32Array | Uint32Array): number {
  return array.length * 4;
}

export function writeI32(memory: WebAssembly.Memory, ptr: number, values: Int32Array): void {
  new Int32Array(memory.buffer, ptr, values.length).set(values);
}

export function writeU32(memory: WebAssembly.Memory, ptr: number, values: Uint32Array): void {
  new Uint32Array(memory.buffer, ptr, values.length).set(values);
}

export function readI32Value(memory: WebAssembly.Memory, ptr: number): number {
  return new Int32Array(memory.buffer, ptr, 1)[0] ?? 0;
}
