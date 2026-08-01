import { devtools } from "@tanstack/devtools-vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, type Plugin } from "vite"

import { automergeRepoImportMethodCompat } from "./scripts/vite-automerge-compat"

function stripConvexTestFallbackGlob(): Plugin {
  return {
    name: "fairlend-strip-convex-test-fallback-glob",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/convex-test/dist/index.js")) return null

      return code.replace('import.meta.glob("../../../convex/**/*.*s")', "{}")
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const isE2eMode = mode === "e2e"
  const isVercelBuild = process.env.VERCEL === "1" && !isE2eMode

  return {
    resolve: {
      dedupe: ["react", "react-dom"],
      tsconfigPaths: true,
      alias: isE2eMode
        ? {
            "@automerge/automerge/slim": "@automerge/automerge",
          }
        : undefined,
    },
    optimizeDeps: {
      // React is CommonJS and must be prebundled. Disabling late dependency
      // discovery keeps its optimized module URL stable for the whole dev
      // session, including across TanStack's split-route HMR updates.
      include: [
        "@automerge/automerge/automerge.wasm.base64",
        "@automerge/automerge/slim",
        "@automerge/automerge-repo/slim",
        "@automerge/automerge-repo-network-broadcastchannel",
        "@automerge/automerge-repo-storage-indexeddb",
        "class-variance-authority",
        "clsx",
        "cmdk",
        "embla-carousel-react",
        "fast-sha256",
        "input-otp",
        "lucide-react",
        "next-themes",
        "react",
        "react-day-picker",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-markdown",
        "react-resizable-panels",
        "recharts",
        "remark-gfm",
        "sonner",
        "tailwind-merge",
        "use-sync-external-store/shim",
        "use-sync-external-store/shim/with-selector",
        "vaul",
        "zod",
      ],
      // The WorkOS package contains assigned createServerFn declarations that
      // must reach TanStack Start's compiler intact. Prebundling can remove an
      // otherwise-unused binding while retaining its call as a side effect,
      // which makes the Start compiler reject the generated dependency chunk.
      exclude: ["@workos/authkit-tanstack-react-start"],
      noDiscovery: true,
      rolldownOptions: {
        // Dependency optimization does not run Vite's normal transform hook.
        // Apply the same narrowly scoped Repo.import compatibility rewrite to
        // the prebundle graph so browsers never receive `import(...)` as a
        // class method declaration.
        plugins: [automergeRepoImportMethodCompat()],
      },
    },
    server: {
      host: "127.0.0.1",
    },
    build: isE2eMode ? { outDir: ".e2e-dist" } : undefined,
    plugins: [
      ...(isE2eMode && command === "build"
        ? [stripConvexTestFallbackGlob()]
        : []),
      automergeRepoImportMethodCompat(),
      devtools(),
      ...(isVercelBuild
        ? []
        : [
            cloudflare({
              viteEnvironment: { name: "ssr" },
              config: isE2eMode
                ? {
                    secrets: { required: [] },
                    vars: {
                      FAIRLEND_E2E_AUTH_KEY:
                        process.env.FAIRLEND_E2E_AUTH_KEY ?? "",
                      FAIRLEND_E2E_ORGANIZATION_ID:
                        process.env.FAIRLEND_E2E_ORGANIZATION_ID ?? "",
                      FAIRLEND_TRANSCRIPTION_API_KEY: "",
                      FAIRLEND_TRANSCRIPTION_API_URL: "",
                      FAIRLEND_TRANSCRIPTION_MODEL: "",
                    },
                  }
                : undefined,
            }),
          ]),
      tailwindcss(),
      tanstackStart(),
      ...(isVercelBuild ? [nitro({ preset: "vercel" })] : []),
      viteReact(),
    ],
  }
})
