import { cva } from "class-variance-authority"

const requestListVariants = cva("request-list", {
  variants: {
    view: {
      stack: "request-list--stack",
      list: "request-list--list",
      grid: "request-list--grid",
    },
  },
  defaultVariants: {
    view: "list",
  },
})

export { requestListVariants }
