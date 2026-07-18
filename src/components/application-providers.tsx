import { ThemeProvider } from "@/components/theme-provider"

export function ApplicationProviders({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="fairlend-theme">
      {children}
    </ThemeProvider>
  )
}
