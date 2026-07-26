// jsdom does not implement matchMedia — chartkit's uPlot dependency calls it
// unconditionally at module-evaluation time, which crashes any jsdom-mode
// test file that transitively imports chartkit (e.g. via `../adapters`)
// before any test body (even beforeAll) gets a chance to run. Pre-existing
// gap, reproduces on a clean checkout — not introduced by any feature work.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
