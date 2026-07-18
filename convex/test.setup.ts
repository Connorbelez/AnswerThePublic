/// <reference types="vite/client" />

export const modules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "!./**/*.config.ts",
  "!./**/*.setup.ts",
])
