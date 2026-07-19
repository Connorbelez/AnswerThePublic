import { cva } from "class-variance-authority"

const applicationNavigationItemVariants = cva(
  "w-full justify-start rounded-xl px-3 text-left transition-[color,background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
  {
    variants: {
      active: {
        true: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground [&_.application-navigation__description]:text-primary-foreground/70",
        false:
          "text-foreground hover:bg-muted [&_.application-navigation__description]:text-muted-foreground",
      },
    },
    defaultVariants: {
      active: false,
    },
  }
)

export { applicationNavigationItemVariants }
