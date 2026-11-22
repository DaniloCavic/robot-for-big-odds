import { PageHeader } from "@/components/ui";
import { getSettings } from "@/lib/settings-repo";
import { availableProviders } from "@/lib/robot/providers";
import { markStaleScans } from "@/lib/robot/runner";
import { recentScans } from "@/lib/robot/scans";
import { zonedYmd, ymdToString } from "@/lib/time";
import { RobotClient } from "./RobotClient";

export default async function RobotPage() {
  await markStaleScans();
  const [settings, scans] = await Promise.all([getSettings(), recentScans(5)]);
  const providers = availableProviders();
  return (
    <>
      <PageHeader title="Robot" subtitle="Value betting: AdmiralBet naspram Pinnacle-a – tipovi gde je kvota veća od poštene." />
      <RobotClient
        providers={providers}
        initialScans={scans}
        today={ymdToString(zonedYmd(new Date()))}
        maxRequests={settings.maxRequestsPerScan}
        valueRules={{ minValuePct: settings.valueMinPct, minOdds: settings.valueMinOdds, maxOdds: settings.valueMaxOdds }}
      />
    </>
  );
}
