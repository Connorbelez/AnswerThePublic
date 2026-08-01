import js from "@eslint/js"
import convexPlugin from "@convex-dev/eslint-plugin"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  // shadcn primitives are generated vendor code; lint the prototype surface,
  // not the scaffold's upstream component implementations.
  globalIgnores([
    "dist",
    "prototype-repo/**",
    "convex/_generated/**",
    "src/routeTree.gen.ts",
    "src/components/ui/**",
    "src/hooks/use-mobile.ts",
  ]),
  ...convexPlugin.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["src/routes/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
])
