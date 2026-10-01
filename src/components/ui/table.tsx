"use client"

import * as React from "react"
import { useIsArc } from "@/components/design/use-design"
import * as Classic from "./classic/table"
import { cx } from "./arc/shared"
import bridge from "./arc/bridge.module.css"

/*
 * Arc has no bare table primitive (its SortableDataTable owns its rows). The
 * app's tables keep their structure — sticky columns depend on it — and take
 * Arc's data-table type, header tone and row hairlines.
 */

function withArc<P extends { className?: string }>(Part: (props: P) => React.ReactNode, arcClass: string) {
  function Switched(props: P) {
    const arc = useIsArc()
    return <Part {...props} className={cx(arc && arcClass, props.className) || undefined} />
  }
  return Switched
}

const Table = withArc(Classic.Table, bridge.table)
const TableHead = withArc(Classic.TableHead, bridge.tableHead)
const TableRow = withArc(Classic.TableRow, bridge.tableRow)
const { TableHeader, TableBody, TableFooter, TableCell, TableCaption } = Classic

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
