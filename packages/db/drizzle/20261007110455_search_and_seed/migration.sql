-- Full-text search. A plain (not contentless) FTS5 table, so a match returns the row id it
-- belongs to. Thai has no spaces between words, so the Worker splits Thai text with
-- Intl.Segmenter before it writes or queries these tables.
CREATE VIRTUAL TABLE `lesson_fts` USING fts5(lesson_id UNINDEXED, title, summary, tags, problem, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE VIRTUAL TABLE `concept_fts` USING fts5(concept_id UNINDEXED, lang UNINDEXED, slug, title, aliases, body, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
-- The curated category tree. Ids are dotted paths, so they read well in URLs and seeds.
INSERT INTO `category` (`id`, `parent_id`, `slug`, `name_en`, `name_th`, `sort`) VALUES
  ('platform', NULL, 'platform', 'Platform', 'แพลตฟอร์ม', 0),
  ('platform.guide', 'platform', 'platform-guide', 'Guides', 'คู่มือ', 10),
  ('math', NULL, 'math', 'Mathematics', 'คณิตศาสตร์', 20),
  ('math.algebra', 'math', 'math-algebra', 'Algebra', 'พีชคณิต', 30),
  ('math.linear-algebra', 'math', 'math-linear-algebra', 'Linear algebra', 'พีชคณิตเชิงเส้น', 40),
  ('math.calculus', 'math', 'math-calculus', 'Calculus', 'แคลคูลัส', 50),
  ('math.analysis', 'math', 'math-analysis', 'Analysis', 'การวิเคราะห์', 60),
  ('math.analysis.real-analysis', 'math.analysis', 'math-analysis-real-analysis', 'Real analysis', 'การวิเคราะห์เชิงจริง', 70),
  ('math.geometry', 'math', 'math-geometry', 'Geometry', 'เรขาคณิต', 80),
  ('math.probability', 'math', 'math-probability', 'Probability and statistics', 'ความน่าจะเป็นและสถิติ', 90),
  ('math.number-theory', 'math', 'math-number-theory', 'Number theory', 'ทฤษฎีจำนวน', 100),
  ('physics', NULL, 'physics', 'Physics', 'ฟิสิกส์', 110),
  ('physics.mechanics', 'physics', 'physics-mechanics', 'Mechanics', 'กลศาสตร์', 120),
  ('physics.electromagnetism', 'physics', 'physics-electromagnetism', 'Electromagnetism', 'แม่เหล็กไฟฟ้า', 130),
  ('physics.thermodynamics', 'physics', 'physics-thermodynamics', 'Thermodynamics', 'อุณหพลศาสตร์', 140),
  ('physics.waves', 'physics', 'physics-waves', 'Waves and optics', 'คลื่นและแสง', 150),
  ('chemistry', NULL, 'chemistry', 'Chemistry', 'เคมี', 160),
  ('programming', NULL, 'programming', 'Programming', 'การเขียนโปรแกรม', 170),
  ('programming.data-structures', 'programming', 'programming-data-structures', 'Data structures', 'โครงสร้างข้อมูล', 180),
  ('programming.algorithms', 'programming', 'programming-algorithms', 'Algorithms', 'อัลกอริทึม', 190),
  ('programming.web', 'programming', 'programming-web', 'Web development', 'การพัฒนาเว็บ', 200),
  ('business', NULL, 'business', 'Business', 'ธุรกิจ', 210),
  ('business.finance', 'business', 'business-finance', 'Finance', 'การเงิน', 220),
  ('business.marketing', 'business', 'business-marketing', 'Marketing', 'การตลาด', 230),
  ('business.strategy', 'business', 'business-strategy', 'Strategy', 'กลยุทธ์', 240),
  ('language', NULL, 'language', 'Languages', 'ภาษา', 250),
  ('language.english', 'language', 'language-english', 'English', 'ภาษาอังกฤษ', 260),
  ('language.thai', 'language', 'language-thai', 'Thai', 'ภาษาไทย', 270);
