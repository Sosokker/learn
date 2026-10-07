-- Concept search (GET /api/concepts?q=). FTS5 is not expressible in Drizzle, so it lives here.
-- A regular (not contentless) FTS table: concept rows are small, and a regular table can be
-- deleted from by row. It is derived data: `concept_lang.search` holds the same text (Thai split
-- into words with Intl.Segmenter('th') before it is stored, because unicode61 does not split
-- Thai), so it can be rebuilt with migrations/README.md's one statement after an export.
CREATE VIRTUAL TABLE `concept_fts` USING fts5(
  `concept_id` UNINDEXED,
  `lang` UNINDEXED,
  `search`,
  tokenize = 'unicode61 remove_diacritics 2'
);
