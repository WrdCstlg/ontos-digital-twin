-- The HR date rule (docs/DECISIONS.md, D-032). The seed stored it as a `sparql`
-- key holding no query, which the SHACL compiler dropped without saying so and
-- now refuses. A database seeded before this change gets the rule as the seed
-- now writes it: sh:lessThanOrEquals, an employment contract's start date on or
-- before its end date. Only that stored constraint is replaced, in every
-- workspace; a second run finds none.
UPDATE `ontology_classes`
SET `shaclJson` = JSON_REPLACE(
  `shaclJson`,
  SUBSTRING_INDEX(JSON_UNQUOTE(JSON_SEARCH(`shaclJson`, 'one', 'endDate >= startDate', NULL, '$.constraints[*].sparql')), '.sparql', 1),
  JSON_OBJECT('path', 'hr:startDate', 'lessThanOrEquals', 'hr:endDate', 'severity', 'Violation', 'message', 'An employment contract cannot end before it starts')
)
WHERE `iri` = 'hr:EmploymentContract'
  AND JSON_SEARCH(`shaclJson`, 'one', 'endDate >= startDate', NULL, '$.constraints[*].sparql') IS NOT NULL;
