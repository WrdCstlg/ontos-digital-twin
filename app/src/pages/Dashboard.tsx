import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { KpiStrip } from '@/components/dashboard/KpiStrip';
import { GraphMiniMap } from '@/components/dashboard/GraphMiniMap';
import { ModuleHealth } from '@/components/dashboard/ModuleHealth';
import { ActivityStream } from '@/components/dashboard/ActivityStream';
import { InsightsPreview } from '@/components/dashboard/InsightsPreview';
import { QueryShortcuts } from '@/components/dashboard/QueryShortcuts';

/**
 * Dashboard — /app — workspace command center (design: dashboard.md).
 * All dynamic content comes from the tRPC API; see components/dashboard/*.
 */
export default function Dashboard() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <DashboardHeader />
      <KpiStrip />
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <GraphMiniMap />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <ModuleHealth />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <ActivityStream />
        </div>
        <div className="col-span-12 xl:col-span-7">
          <InsightsPreview />
        </div>
      </div>
      <QueryShortcuts />
    </div>
  );
}
