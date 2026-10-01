"use client"

import * as React from "react"
import { useIsArc } from "@/components/design/use-design"
import * as ClassicCard from "./classic/card"
import { cx } from "./arc/shared"
import bridge from "./arc/bridge.module.css"

/*
 * Arc's Card is one composed component (title, media, status, an expanding
 * detail panel). The app's cards are layout containers, so in Arc they take Arc's
 * card surface — radius, hairline, resting shadow — and its title type.
 */

type DivProps = React.ComponentProps<"div">

function part(Classic: (props: DivProps) => React.ReactNode, arcClass: string) {
  function Part({ className, ...props }: DivProps) {
    const arc = useIsArc()
    if (!arc) return <Classic className={className} {...props} />
    return <div {...props} className={cx(arcClass, className)} />
  }
  return Part
}

const Card = part(ClassicCard.Card as (props: DivProps) => React.ReactNode, bridge.card)
const CardHeader = part(ClassicCard.CardHeader, bridge.cardHeader)
const CardTitle = part(ClassicCard.CardTitle, bridge.cardTitle)
const CardDescription = part(ClassicCard.CardDescription, bridge.cardDescription)
const CardAction = part(ClassicCard.CardAction, "")
const CardContent = part(ClassicCard.CardContent, bridge.cardContent)
const CardFooter = part(ClassicCard.CardFooter, bridge.cardFooter)

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
