"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"

/**
 * shadcn-style Calendar over react-day-picker v9.
 *
 * Styled to the Stripe palette the rest of this app uses (#635BFF brand,
 * #0A2540 ink, #E3E8EF hairlines) rather than the shadcn defaults, so a date
 * cell looks like it belongs to the same product as the table behind it.
 *
 * Day cells are 36px. That is under the 44px touch guidance and is a deliberate
 * exception: a 44px grid makes a month 320px wide before padding, which stops
 * fitting a popover on a 375px screen — and every cell here has a large,
 * clearly-labelled alternative in the two text inputs above it.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-1", className)}
      classNames={{
        // `relative` belongs HERE, on the nav's actual PARENT. react-day-picker
        // renders <nav> as a child of `months`, a sibling of `month` — putting
        // it on `month` positions the nav against nothing, and the absolute
        // chevrons escape to the nearest positioned ancestor, which is the
        // popover, landing in its corners over unrelated labels.
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "text-[13px] font-semibold text-ink",
        // One row spanning the caption; the buttons sit at its ends. Laying the
        // nav out as a box and letting the buttons be static keeps the two
        // arrows tied to the month they page, however many months are shown.
        nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between px-1",
        button_previous:
          "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-40",
        button_next:
          "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-40",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 text-[11px] font-medium text-ink-faint uppercase tracking-wide",
        week: "flex w-full mt-1",
        day: "relative h-9 w-9 p-0 text-center text-[13px]",
        day_button:
          "h-9 w-9 cursor-pointer rounded-lg font-normal text-ink-soft transition-colors duration-150 hover:bg-wash focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
        // The ends of a range are filled; the days between are tinted. Without
        // that difference a range reads as a blob and you cannot see which day
        // you actually picked.
        selected: "bg-brand text-white hover:bg-brand",
        range_start: "rounded-l-lg",
        range_end: "rounded-r-lg",
        range_middle:
          "bg-brand-wash text-ink [&>button]:bg-transparent [&>button]:text-ink",
        today: "font-semibold text-brand",
        outside: "text-[#B4BCC8]",
        disabled: "text-line-strong opacity-60",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" aria-hidden="true" {...rest} />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" {...rest} />
          ),
      }}
      {...props}
    />
  )
}

export { Calendar }
