"use client"

import * as React from "react"
import { Progress as ArcProgress } from "@/components/arc/components/progress/progress"
import { useIsArc } from "@/components/design/use-design"
import * as Classic from "./classic/progress"
import { classOf } from "./arc/shared"

type ClassicProps<T extends (props: never) => unknown> = Parameters<T>[0]

/** In Arc the whole bar is Arc's Progress; the track/indicator parts are its own. */
function Progress(props: ClassicProps<typeof Classic.Progress>) {
  const arc = useIsArc()
  if (!arc) return <Classic.Progress {...props} />
  return <ArcProgress value={props.value ?? 0} max={props.max ?? 100} className={classOf(props.className)} aria-label={props["aria-label"]} />
}

const { ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue } = Classic

export { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue }
