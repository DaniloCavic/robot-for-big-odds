import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings-repo";
import { createFilterSet, listFilterSets } from "@/lib/filter/service";
import { body, handle } from "@/lib/filter/http";

export const dynamic = "force-dynamic";

export const GET = () => handle(async () => Response.json(await listFilterSets(prisma, "VALUE")));

export const POST = (req: Request) => handle(async (user) => {
  const { name } = await body(req);
  // value betting: svi novi filteri su Value
  const strategy = "VALUE";
  const settings = await getSettings();
  const id = await createFilterSet(prisma, { name, userId: user.id, stake: settings.stakePerSelection, strategy });
  return Response.json({ id }, { status: 201 });
});
