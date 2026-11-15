import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings-repo";
import { createFilterSet, listFilterSets } from "@/lib/filter/service";
import { body, handle } from "@/lib/filter/http";

export const dynamic = "force-dynamic";

export const GET = () => handle(async () => Response.json(await listFilterSets(prisma, "KONTRA")));

export const POST = (req: Request) => handle(async (user) => {
  const { name } = await body(req);
  // skener velikih kvota: svi novi filteri su Kontra (0–1, 4+)
  const strategy = "KONTRA";
  const settings = await getSettings();
  const id = await createFilterSet(prisma, { name, userId: user.id, stake: settings.stakePerSelection, strategy });
  return Response.json({ id }, { status: 201 });
});
