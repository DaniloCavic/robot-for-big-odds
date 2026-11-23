-- Value filter: ulog „na dobitak“ zaokružen NAVIŠE na ceo dinar (998,34 → 999).
-- Preračunavaju se tipovi u Value filterima (i isplata/neto već obračunatih).
UPDATE "FilterSetSelection" e
SET "stake" = CEIL(ROUND(fs."stakePerSelection" / (e."oddsSnapshot" - 1), 6))
FROM "FilterSet" fs
WHERE e."filterSetId" = fs."id" AND fs."strategy" = 'VALUE' AND e."oddsSnapshot" > 1;

UPDATE "FilterSetSelection" e
SET "grossReturn" = CASE e."settlementStatus"
      WHEN 'WON' THEN ROUND(e."stake" * e."oddsSnapshot", 2)
      WHEN 'LOST' THEN 0
      WHEN 'VOID' THEN e."stake"
    END,
    "netProfit" = CASE e."settlementStatus"
      WHEN 'WON' THEN ROUND(e."stake" * e."oddsSnapshot", 2) - e."stake"
      WHEN 'LOST' THEN -e."stake"
      WHEN 'VOID' THEN 0
    END
FROM "FilterSet" fs
WHERE e."filterSetId" = fs."id" AND fs."strategy" = 'VALUE' AND e."settlementStatus" IN ('WON', 'LOST', 'VOID');
