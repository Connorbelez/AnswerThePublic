import { Link } from "@tanstack/react-router"
import { type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ButtonStyleProps = VariantProps<typeof buttonVariants>

function ButtonLink({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<typeof Link> & ButtonStyleProps) {
  return (
    <Link
      data-slot="button-link"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

function ButtonAnchor({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<"a"> & ButtonStyleProps) {
  return (
    <a
      data-slot="button-link"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { ButtonAnchor, ButtonLink }
