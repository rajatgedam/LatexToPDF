import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let counter = 0;
URL.createObjectURL = vi.fn(() => `blob:mock/${++counter}`);
URL.revokeObjectURL = vi.fn();
