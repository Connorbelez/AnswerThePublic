import { cva } from "class-variance-authority"

const contextCardVariants = cva("unified-context-card", {
  variants: {
    pinned: {
      true: "is-pinned",
      false: "",
    },
  },
  defaultVariants: {
    pinned: false,
  },
})

export { contextCardVariants }
