import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your overview</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Last updated: —</span>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Cases"
          value="0"
          description="Activated cases"
        />
        <StatsCard
          title="Bills Generated"
          value="0"
          description="PDF bills created"
        />
        <StatsCard
          title="Home Fibre"
          value="0"
          description="Home fibre cases"
        />
        <StatsCard
          title="Business Fibre"
          value="0"
          description="Business fibre cases"
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Cases */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Cases</CardTitle>
              <div className="flex items-center gap-2 text-sm">
                <button className="text-foreground font-medium">
                  List View
                </button>
                <button className="text-muted-foreground">Timeline</button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4 text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">
              <span>Customer</span>
              <span>Case No.</span>
              <span>Status</span>
              <span>Provider</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">No cases yet</p>
              <p className="text-xs mt-1">
                Run a crawl to populate your dashboard
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <button className="text-xs text-muted-foreground">Filter</button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">No activity yet</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatsCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-sm">{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}
