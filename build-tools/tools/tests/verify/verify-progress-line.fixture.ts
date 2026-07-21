export function captureProgressStream(isTTY: boolean) {
  const writes: string[] = [];
  return {
    writes,
    stream: {
      isTTY,
      write: (chunk: unknown) => {
        writes.push(String(chunk));
      },
    },
  };
}
