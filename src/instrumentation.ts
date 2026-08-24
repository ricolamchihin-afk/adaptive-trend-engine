export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAutoLoop } = await import("./lib/engine/autoRunner");
  startAutoLoop();
}
