import type { CardKind, Role } from "@app/domain"

// Every piece of renderer chrome, in both UI languages. Lesson text never comes from here.
export interface Strings {
  readonly showMe: string
  readonly letMeTry: string
  readonly modeLabel: string
  readonly contents: string
  readonly reveal: string
  readonly picked: string
  readonly notPicked: string
  readonly why: string
  readonly whyNot: string
  readonly notUsed: string
  readonly step: string
  readonly move: string
  readonly formula: string
  readonly question: string
  readonly line: string
  readonly uses: string
  readonly usesTitle: string
  readonly intuition: string
  readonly goal: string
  readonly concept: string
  readonly field: string
  readonly prerequisites: string
  readonly problem: string
  readonly correct: string
  readonly notQuite: string
  readonly answer: string
  readonly sharedConcept: string
  readonly usedBy: (n: number) => string
  readonly version: (n: number) => string
  readonly whereThisSits: string
  readonly addRef: string
  readonly close: string
  readonly unpin: string
  readonly missingCard: string
  readonly inspectorEmpty: string
  readonly inspectorHint: string
  readonly partsLegend: string
  readonly meaning: string
  readonly body: string
  readonly example: string
  readonly analogy: string
  readonly says: string
  readonly from: string
  readonly useWhen: string
  readonly units: string
  readonly askPlaceholder: string
  readonly askHint: string
  readonly copyPrompt: string
  readonly copied: string
  readonly copyFailed: string
  readonly removeRef: string
  readonly loading: string
  readonly exprError: string
  readonly openLesson: string
  readonly variable: string
  readonly value: string
  readonly promptContext: (title: string, slug: string) => string
  readonly promptNoQuestion: string
  readonly roles: Readonly<Record<Role, string>>
  readonly kinds: Readonly<Record<CardKind, string>>
  readonly nodeKinds: Readonly<Record<string, string>>
  readonly forces: Readonly<Record<string, string>>
  readonly sectionTypes: Readonly<Record<string, string>>
}

const en: Strings = {
  showMe: "Show me",
  letMeTry: "Let me try",
  modeLabel: "Reading mode",
  contents: "Contents",
  reveal: "Click to reveal",
  picked: "picked",
  notPicked: "not picked",
  why: "Why",
  whyNot: "Why not",
  notUsed: "Not used",
  step: "Step",
  move: "Move",
  formula: "Formula",
  question: "Q",
  line: "Line",
  uses: "uses",
  usesTitle: "Uses",
  intuition: "Intuition",
  goal: "Goal",
  concept: "Concept",
  field: "Field",
  prerequisites: "Needed first",
  problem: "Problem",
  correct: "Correct",
  notQuite: "Not quite",
  answer: "Answer",
  sharedConcept: "shared concept",
  usedBy: (n) => (n === 1 ? "used by 1 lesson" : `used by ${n} lessons`),
  version: (n) => `v${n}`,
  whereThisSits: "Where this sits",
  addRef: "@ add",
  close: "Close",
  unpin: "Unpin",
  missingCard: "This card is not available.",
  inspectorEmpty: "Nothing pinned",
  inspectorHint: "Hover a dashed word to preview its card. Click to pin it, then click inside to go deeper.",
  partsLegend: "Parts in this lesson",
  meaning: "Meaning",
  body: "Details",
  example: "Example",
  analogy: "Analogy",
  says: "Says",
  from: "Comes from",
  useWhen: "Use when",
  units: "Units",
  askPlaceholder: "Ask pi about this lesson…",
  askHint: "Alt-click anything, or press @ while hovering, to point at it.",
  copyPrompt: "Copy prompt for pi",
  copied: "Copied",
  copyFailed: "Copy failed",
  removeRef: "Remove",
  loading: "Loading…",
  exprError: "cannot draw",
  openLesson: "lesson",
  variable: "Variable",
  value: "Value",
  promptContext: (title, slug) => `Context from the lesson "${title}" (@${slug}):`,
  promptNoQuestion: "(no question yet)",
  roles: {
    given: "given",
    hidden_given: "hidden given",
    goal: "goal",
    derived: "derived",
    constant: "constant",
    condition: "condition",
    actor: "actor",
    metric: "metric",
    variable: "variable",
    concept: "concept",
  },
  kinds: {
    term: "term",
    law: "law",
    formula: "formula",
    def: "definition",
    lemma: "lemma",
    thm: "theorem",
    metric: "metric",
    story: "story",
    feature: "feature",
  },
  nodeKinds: {
    goal: "goal",
    lemma: "lemma",
    thm: "theorem",
    law: "law",
    def: "definition",
    part: "part",
    step: "step",
  },
  forces: { weight: "weight", normal: "normal", friction: "friction", accel: "acceleration" },
  sectionTypes: {
    text: "text",
    problem: "problem",
    chunks: "chunks",
    concept: "concept",
    plan: "plan",
    chain: "chain",
    proof: "proof",
    graph: "graph",
    visual: "visual",
    check: "check",
    story: "story",
    units: "study plan",
    recall: "recall",
  },
}

const th: Strings = {
  showMe: "ดูเฉลย",
  letMeTry: "ขอลองเอง",
  modeLabel: "โหมดการอ่าน",
  contents: "สารบัญ",
  reveal: "คลิกเพื่อดู",
  picked: "เลือกทางนี้",
  notPicked: "ไม่เลือก",
  why: "ทำไม",
  whyNot: "ทำไมไม่",
  notUsed: "ไม่ได้ใช้",
  step: "ขั้นที่",
  move: "ทำ",
  formula: "สูตร",
  question: "คำถาม",
  line: "บรรทัด",
  uses: "ใช้",
  usesTitle: "ใช้",
  intuition: "สัญชาตญาณ",
  goal: "เป้าหมาย",
  concept: "แนวคิด",
  field: "สาขา",
  prerequisites: "ต้องรู้ก่อน",
  problem: "โจทย์",
  correct: "ถูกต้อง",
  notQuite: "ยังไม่ใช่",
  answer: "คำตอบ",
  sharedConcept: "แนวคิดที่ใช้ร่วมกัน",
  usedBy: (n) => `ใช้ใน ${n} บทเรียน`,
  version: (n) => `v${n}`,
  whereThisSits: "อยู่ตรงไหน",
  addRef: "@ เพิ่ม",
  close: "ปิด",
  unpin: "เลิกปักหมุด",
  missingCard: "ไม่มีการ์ดนี้",
  inspectorEmpty: "ยังไม่ได้ปักหมุดการ์ด",
  inspectorHint: "ชี้ที่คำเส้นประเพื่อดูการ์ด คลิกเพื่อปักหมุด แล้วคลิกในการ์ดเพื่อเจาะลึกต่อ",
  partsLegend: "ชิ้นส่วนในบทเรียนนี้",
  meaning: "ความหมาย",
  body: "รายละเอียด",
  example: "ตัวอย่าง",
  analogy: "เปรียบเทียบ",
  says: "บอกว่า",
  from: "มาจาก",
  useWhen: "ใช้เมื่อ",
  units: "หน่วย",
  askPlaceholder: "ถาม pi เกี่ยวกับบทเรียนนี้…",
  askHint: "กด Alt แล้วคลิก หรือกด @ ขณะชี้ เพื่ออ้างอิงส่วนนั้น",
  copyPrompt: "คัดลอกพรอมต์ให้ pi",
  copied: "คัดลอกแล้ว",
  copyFailed: "คัดลอกไม่สำเร็จ",
  removeRef: "ลบ",
  loading: "กำลังโหลด…",
  exprError: "วาดไม่ได้",
  openLesson: "บทเรียน",
  variable: "ตัวแปร",
  value: "ค่า",
  promptContext: (title, slug) => `บริบทจากบทเรียน "${title}" (@${slug}):`,
  promptNoQuestion: "(ยังไม่มีคำถาม)",
  roles: {
    given: "ข้อมูลที่ให้",
    hidden_given: "ข้อมูลที่ซ่อนอยู่",
    goal: "เป้าหมาย",
    derived: "หาได้จากข้อมูล",
    constant: "ค่าคงที่",
    condition: "เงื่อนไข",
    actor: "ผู้เกี่ยวข้อง",
    metric: "ตัวชี้วัด",
    variable: "ตัวแปร",
    concept: "แนวคิด",
  },
  kinds: {
    term: "คำศัพท์",
    law: "กฎ",
    formula: "สูตร",
    def: "นิยาม",
    lemma: "บทตั้ง",
    thm: "ทฤษฎีบท",
    metric: "ตัวชี้วัด",
    story: "เรื่องเล่า",
    feature: "ฟีเจอร์",
  },
  nodeKinds: {
    goal: "เป้าหมาย",
    lemma: "บทตั้ง",
    thm: "ทฤษฎีบท",
    law: "กฎ",
    def: "นิยาม",
    part: "ชิ้นส่วน",
    step: "ขั้น",
  },
  forces: { weight: "น้ำหนัก", normal: "แรงตั้งฉาก", friction: "แรงเสียดทาน", accel: "ความเร่ง" },
  sectionTypes: {
    text: "ข้อความ",
    problem: "โจทย์",
    chunks: "แยกส่วน",
    concept: "แนวคิด",
    plan: "แผน",
    chain: "ลำดับขั้น",
    proof: "บทพิสูจน์",
    graph: "กราฟ",
    visual: "ภาพ",
    check: "ตรวจ",
    story: "เรื่องเล่า",
    units: "แผนการเรียน",
    recall: "ทบทวน",
  },
}

export const strings: Readonly<Record<"en" | "th", Strings>> = { en, th }
