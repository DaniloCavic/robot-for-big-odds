import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { listFilterSets } from "@/lib/filter/service";
import { recentScans } from "@/lib/robot/scans";
import { FilterClient } from "./FilterClient";

export default async function FilterPage() {
  const [sets, scans] = await Promise.all([listFilterSets(prisma, "KONTRA"), recentScans(15)]);
  return (
    <>
      <PageHeader title="Filter" subtitle="Prevucite tipove 0–1 i 4+ iz leve kolone u svoj filter. Sve se čuva odmah." />
      <FilterClient
        initialSets={sets}
        scans={scans.filter((s) => s.status !== "RUNNING" && s.selectionsFound > 0)}
      />
    </>
  );
}
