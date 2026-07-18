import { devtools } from "@tanstack/devtools-vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

function stripConvexTestFallbackGlob(): Plugin {
  return {
    name: "fairlend-strip-convex-test-fallback-glob",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/convex-test/dist/index.js")) return null

      return code.replace(
        'import.meta.glob("../../../convex/**/*.*s")',
        "{}"
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const isE2eBuild = mode === "e2e"

  return {
    resolve: { tsconfigPaths: true },
    build: isE2eBuild ? { outDir: ".e2e-dist" } : undefined,
    plugins: [
      ...(isE2eBuild ? [stripConvexTestFallbackGlob()] : []),
      devtools(),
      cloudflare({
        viteEnvironment: { name: "ssr" },
        config: isE2eBuild
          ? {
              vars: {
                FAIRLEND_E2E_AUTH_KEY:
                  process.env.FAIRLEND_E2E_AUTH_KEY ?? "",
                FAIRLEND_E2E_ORGANIZATION_ID:
                  process.env.FAIRLEND_E2E_ORGANIZATION_ID ?? "",
              },
            }
          : undefined,
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  }
})
