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
        caption_label: "text-[13px] font-semibold text-[#0A2540]",
        // One row spanning the caption; the buttons sit at its ends. Laying the
        // nav out as a box and letting the buttons be static keeps the two
        // arrows tied to the month they page, however many months are shown.
        nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between px-1",
        button_previous:
          "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[#697386] transition-colors duration-150 hover:bg-[#F6F9FC] hover:text-[#0A2540] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF] disabled:pointer-events-none disabled:opacity-40",
        button_next:
          "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[#697386] transition-colors duration-150 hover:bg-[#F6F9FC] hover:text-[#0A2540] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF] disabled:pointer-events-none disabled:opacity-40",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 text-[11px] font-medium text-[#8792A2] uppercase tracking-wide",
        week: "flex w-full mt-1",
        day: "relative h-9 w-9 p-0 text-center text-[13px]",
        day_button:
          "h-9 w-9 cursor-pointer rounded-lg font-normal text-[#425466] transition-colors duration-150 hover:bg-[#F6F9FC] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#635BFF]",
        // The ends of a range are filled; the days between are tinted. Without
        // that difference a range reads as a blob and you cannot see which day
        // you actually picked.
        selected: "bg-[#635BFF] text-white hover:bg-[#635BFF]",
        range_start: "rounded-l-lg",
        range_end: "rounded-r-lg",
        range_middle:
          "bg-[#EDEBFF] text-[#0A2540] [&>button]:bg-transparent [&>button]:text-[#0A2540]",
        today: "font-semibold text-[#635BFF]",
        outside: "text-[#B4BCC8]",
        disabled: "text-[#CBD2DC] opacity-60",
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
