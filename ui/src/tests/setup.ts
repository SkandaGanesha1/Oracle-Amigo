import "@testing-library/jest-dom/vitest";

// Polyfill ResizeObserver for HeroUI components in jsdom
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as any).ResizeObserver = ResizeObserverMock;
}

// Polyfill matchMedia
if (typeof window !== "undefined" && !("matchMedia" in window)) {
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Polyfill IntersectionObserver
if (typeof window !== "undefined" && !("IntersectionObserver" in window)) {
  class IntersectionObserverMock {
    readonly root: Element | null = null;
    readonly rootMargin: string = "0px";
    readonly thresholds: ReadonlyArray<number> = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  (window as any).IntersectionObserver = IntersectionObserverMock;
  (window as any).IntersectionObserverEntry = class {};
}
