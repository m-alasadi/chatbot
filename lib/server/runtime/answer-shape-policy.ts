function normalizeArabicLight(text: string): string {
  return (text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim()
}

export function isOfficeHolderFactQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  return norm.includes("المتولي") && norm.includes("الشرعي")
}

export function isAbbasChildrenQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  const asksChildren = ["ابناء", "أبناء", "اولاد", "أولاد"].some(t => norm.includes(normalizeArabicLight(t)))
  const isAbbas = ["ابي الفضل", "أبي الفضل", "ابو الفضل", "العباس"].some(t => norm.includes(normalizeArabicLight(t)))
  return asksChildren && isAbbas
}

export function buildDeterministicFactFallback(query: string): any | null {
  if (isOfficeHolderFactQuery(query)) {
    return {
      id: "fallback_office_holder",
      name: "المتولي الشرعي للعتبة العباسية",
      description: "اسم المتولي الشرعي للعتبة العباسية المقدسة هو سماحة العلامة السيد أحمد الصافي.",
      url: "https://alkafeel.net/",
      source_type: "deterministic_fallback"
    }
  }

  if (isAbbasChildrenQuery(query)) {
    return {
      id: "fallback_abbas_children",
      name: "أبناء أبي الفضل العباس",
      description: "بحسب المصادر التاريخية، من أبناء أبي الفضل العباس (عليه السلام): الفضل، عبيد الله، الحسن، القاسم، ومحمد.",
      url: "https://alkafeel.net/abbas?lang=ar",
      source_type: "deterministic_fallback"
    }
  }

  return null
}

export function getDeterministicDirectAnswer(query: string): string | null {
  if (isOfficeHolderFactQuery(query)) {
    return "المتولي الشرعي للعتبة العباسية المقدسة هو سماحة العلامة السيد أحمد الصافي."
  }

  if (isAbbasChildrenQuery(query)) {
    return "بحسب المصادر التاريخية، من أبناء أبي الفضل العباس (عليه السلام): الفضل، عبيد الله، الحسن، القاسم، ومحمد."
  }

  const norm = normalizeArabicLight(query)
  const asksSingularFoodProject =
    norm.includes(normalizeArabicLight("مشروع")) &&
    ["دجاج", "غذائي", "انتاج", "إنتاج"].some(t => norm.includes(normalizeArabicLight(t)))
  if (asksSingularFoodProject) {
    return "لا تتوفر في البيانات الحالية معلومة مؤكدة عن مشروع دجاج أو مشروع غذائي مماثل تابع للعتبة العباسية المقدسة."
  }

  return null
}

export function buildAnswerShapeInstruction(text: string): string | null {
  const norm = normalizeArabicLight(text)
  const directOnly =
    norm.includes(normalizeArabicLight("الجواب المباشر")) ||
    norm.includes(normalizeArabicLight("جواب مباشر")) ||
    norm.includes(normalizeArabicLight("فقط")) ||
    norm.includes(normalizeArabicLight("دون عناوين")) ||
    norm.includes(normalizeArabicLight("دون روابط"))
  const twoLines = norm.includes(normalizeArabicLight("سطرين"))

  if (!directOnly && !twoLines) return null

  if (twoLines) {
    return "تعليمات شكل الإجابة: أجب في سطرين فقط كحد أقصى، دون قوائم أو روابط أو عناوين، وبدون جملة ختامية من نوع (هل تريد تفاصيل أكثر)."
  }
  return "تعليمات شكل الإجابة: أعطِ الجواب المباشر فقط في جملة واحدة قصيرة، دون قوائم أو روابط أو عناوين، وبدون جملة ختامية من نوع (هل تريد تفاصيل أكثر)."
}
