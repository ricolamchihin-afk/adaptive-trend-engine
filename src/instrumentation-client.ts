// Phantom / other wallets inject window.ethereum and crash Next's overlay with
// "Cannot redefine property: ethereum". Swallow that noise; this app does not
// use MetaMask.
function isWalletInjectNoise(value: unknown): boolean {
  const text = String(value ?? "");
  return text.includes("Cannot redefine property: ethereum") || text.includes("evmAsk.js");
}

window.addEventListener(
  "error",
  (event) => {
    if (isWalletInjectNoise(event.message) || isWalletInjectNoise(event.error)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

window.addEventListener(
  "unhandledrejection",
  (event) => {
    if (isWalletInjectNoise(event.reason)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
