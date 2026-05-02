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

import { detectAbbasRelationSlot, type PersonRelationSlot } from "../../ai/paraphrase-intent"

// ── Ambient slot context ─────────────────────────────────────────────
// getDeterministicDirectAnswer is fully synchronous (no awaits), so it is
// safe to set a module-level variable for the duration of one invocation.
// This lets all internal isAbbasXxx() helpers benefit from an LLM-resolved
// slot without threading the parameter through every call site.
let _ambientSlot: PersonRelationSlot | null | undefined = undefined

/**
 * Resolve the Abbas relation slot for a query.
 * Prefers the LLM-resolved slot from the current invocation context
 * over re-running the regex detector.
 */
function resolveSlot(query: string): PersonRelationSlot | null {
  if (_ambientSlot !== undefined) return _ambientSlot
  return detectAbbasRelationSlot(query)
}

function includesAny(norm: string, candidates: string[]): boolean {
  return candidates.some(c => norm.includes(normalizeArabicLight(c)))
}

function hasAbbasPersonSignal(norm: string): boolean {
  const explicitPersonSignals = includesAny(norm, [
    "ابي الفضل",
    "أبي الفضل",
    "ابو الفضل",
    "أبو الفضل",
    "العباس بن علي",
    "قمر بني هاشم"
  ])

  // Treat plain "العباس" as person only when not clearly referring to
  // institutional phrases like "العتبة العباسية".
  const plainAbbas = norm.includes(normalizeArabicLight("العباس"))
  const institutionalAbbas =
    norm.includes(normalizeArabicLight("العباسية")) ||
    norm.includes(normalizeArabicLight("العتبة"))

  return explicitPersonSignals || (plainAbbas && !institutionalAbbas)
}

function hasOfficeHolderSignal(norm: string): boolean {
  return includesAny(norm, ["المتولي", "الشرعي"])
}

function hasTopResponsibleShrineSignal(norm: string): boolean {
  return includesAny(norm, [
    "المسؤول الاعلى",
    "المسؤول الأعلى",
    "اعلى مسؤول",
    "أعلى مسؤول",
    "منو المسؤول الاعلى",
    "منو المسؤول الأعلى"
  ]) && includesAny(norm, ["العتبة العباسية", "العتبه العباسيه", "العتبة", "العتبه"])
}

function hasRadioKafeelSignal(norm: string): boolean {
  return includesAny(norm, ["اذاعة الكفيل", "إذاعة الكفيل", "راديو الكفيل", "الإذاعة"])
}

function hasShrineLocationSignal(norm: string): boolean {
  // Don't trigger on website-navigation queries — "موقع" means "website" here, not "location"
  const isWebNavQuery = includesAny(norm, ["اقسام", "أقسام", "قسم", "فيديو", "محتوى", "خدمات", "ما في", "ما هي", "ما هو"])
  if (isWebNavQuery) {
    return includesAny(norm, ["اين تقع", "أين تقع", "تقع العتبة", "موقع المرقد"])
  }
  return includesAny(norm, ["اين تقع", "أين تقع", "موقع العتبة", "تقع العتبة", "موقع المرقد"])
}

function hasNidaAqeedaSignal(norm: string): boolean {
  return includesAny(norm, ["نداء العقيدة", "نداء العقيده"])
}

function isNameOnlyQuery(norm: string): boolean {
  return includesAny(norm, [
    "الاسم فقط",
    "اذكر الاسم فقط",
    "أذكر الاسم فقط",
    "اعطني الاسم فقط",
    "أعطني الاسم فقط",
    "اسم فقط"
  ])
}

function isWomenOfficeAffiliationQuery(norm: string): boolean {
  return includesAny(norm, [
    "مكتب المتولي الشرعي للشؤون النسوية",
    "الشؤون النسوية"
  ]) && includesAny(norm, [
    "جهة مستقلة",
    "جزء من مكتب المتولي",
    "جزء من مكتب",
    "تابع لمكتب المتولي",
    "جزء من مكتب المتولي الشرعي"
  ])
}

function isOfficeHolderFactNameQuery(norm: string): boolean {
  return hasOfficeHolderSignal(norm) &&
    includesAny(norm, [
      "من المسؤول الشرعي الحالي",
      "المسؤول الشرعي الحالي",
      "من هو المتولي الشرعي",
      "من المتولي الشرعي",
      "من هو المسؤول الشرعي",
      "من المسؤول الشرعي",
      "اسم المتولي الشرعي"
    ]) &&
    !includesAny(norm, [
      "الفرق",
      "رئيس قسم",
      "منصب",
      "مكتب المتولي",
      "هل ستفهم",
      "اقصد",
      "أقصد"
    ])
}

function isRadioKafeelContentVarietyQuery(norm: string): boolean {
  return hasRadioKafeelSignal(norm) &&
    includesAny(norm, ["برامج دينية فقط", "متنوعة", "متنوع", "فقط ام متنوعة", "فقط أم متنوعة"])
}

function isOfficeHolderVsHeadQuery(norm: string): boolean {
  return (hasOfficeHolderSignal(norm) || hasTopResponsibleShrineSignal(norm)) &&
    includesAny(norm, ["رئيس قسم", "منصب اشرافي", "منصب إشرافي", "اشرافي اعلى", "إشرافي أعلى", "اعلى"])
}

function isOfficeHolderOfficeDifferenceQuery(norm: string): boolean {
  return includesAny(norm, ["الفرق بين المتولي الشرعي ومكتب المتولي الشرعي", "مكتب المتولي الشرعي"]) &&
    includesAny(norm, ["الفرق", "ما الفرق", "فرق"])
}

function isOfficeHolderHighestMeaningQuery(norm: string): boolean {
  return hasTopResponsibleShrineSignal(norm) &&
    includesAny(norm, ["هل ستفهم", "هل سافهم", "هل سأفهم", "اقصد", "أقصد", "اذا قلت لك", "إذا قلت لك"])
}

function isRadioKafeelTypeQuery(norm: string): boolean {
  return hasRadioKafeelSignal(norm) &&
    includesAny(norm, ["مشروع اعلامي", "مشروع إعلامي", "اذاعة فعلية", "إذاعة فعلية", "مجرد قسم", "قسم في الموقع"])
}

function isRadioKafeelLocationQuery(norm: string): boolean {
  return hasRadioKafeelSignal(norm) &&
    includesAny(norm, ["اين اجد", "أين أجد", "داخل الموقع", "محتوى", "اين القى", "أين ألقى"])
}

function isNidaAqeedaTimingQuery(norm: string): boolean {
  return hasNidaAqeedaSignal(norm) &&
    includesAny(norm, ["متى", "عادة", "عادةً", "غالبا", "غالباً", "موسم"])
}

function isNidaAqeedaAffiliationQuery(norm: string): boolean {
  return hasNidaAqeedaSignal(norm) &&
    includesAny(norm, ["تابع", "مباشرة", "جهة اخرى", "جهة أخرى", "مرتبطة", "مرتبط"])
}

function isNidaAqeedaSummaryIntentQuery(norm: string): boolean {
  return hasNidaAqeedaSignal(norm) &&
    includesAny(norm, ["اختصر", "بجملة", "تعريفا", "تعريفاً", "تعريف", "خبرا", "خبراً", "خبر"])
}

function isNidaAqeedaVsImamaWeekQuery(norm: string): boolean {
  return hasNidaAqeedaSignal(norm) && isImamaWeekQuery(norm)
}

function isNidaAqeedaContinuityQuery(norm: string): boolean {
  return hasNidaAqeedaSignal(norm) &&
    includesAny(norm, ["مستمر", "مناسبة مؤقتة", "مؤقتة", "مؤقته", "موسمية", "برنامج مستمر"])
}

function isUniversityOnlyProjectQuery(norm: string): boolean {
  return includesAny(norm, [
    "مشروع جامعي",
    "جامعي غير المدارس",
    "غير المدارس",
    "جامعة الكفيل",
    "جامعة العميد"
  ]) && includesAny(norm, ["مشروع", "تعليمي", "جامعي", "للعتبة", "تابع"])
}

function isUniversityVsSchoolsTypeQuery(norm: string): boolean {
  return includesAny(norm, ["الفرق بين جامعة الكفيل ومدارس العميد", "جامعة الكفيل ومدارس العميد"]) &&
    includesAny(norm, ["الفرق", "من حيث النوع", "نوع"])
}

function isUniversityAffiliationCapabilityQuery(norm: string): boolean {
  return includesAny(norm, ["جامعة العميد", "شنو مشاريعهم التعليمية", "ما مشاريعهم التعليمية"]) &&
    includesAny(norm, ["تابع", "للعتبة", "تعليمي"])
}

function isAmeedUniversityAffiliationQuery(norm: string): boolean {
  return includesAny(norm, ["جامعة العميد"]) &&
    includesAny(norm, ["تابع", "للعتبة", "تعليمي", "مشروع"])
}

function isFoodOrLivestockProjectQuery(norm: string): boolean {
  return includesAny(norm, ["الدجاج", "دواجن", "ثروة حيوانية", "غذاء", "غذائي", "لحوم", "انتاجي", "إنتاجي"])
}

function isProjectTypeDifferenceQuery(norm: string): boolean {
  return includesAny(norm, ["الفرق بين مشروع وقسم ومركز", "ما الفرق بين مشروع وقسم ومركز", "مشروع وقسم ومركز"])
}

function isAbbasQuestionTypesDifferenceQuery(norm: string): boolean {
  return hasAbbasPersonSignal(norm) &&
    includesAny(norm, ["ما الفرق بين سؤال من هو العباس", "ما الفرق بين سؤال من هو العباس وسؤال ما ألقابه", "ما الفرق بين سؤال"])
}

function isAbbasPronounFollowUpCapabilityQuery(norm: string): boolean {
  return hasAbbasPersonSignal(norm) &&
    includesAny(norm, ["وكم كان عمره", "هل ستفهم", "هل سيفهم", "الضمير يعود عليه"])
}

function isWahyVsSermonQuestion(norm: string): boolean {
  return includesAny(norm, ["من وحي الجمعة", "من وحي الجمعه", "وحي الجمعة", "وحي الجمعه"]) &&
    includesAny(norm, [
      "خطب الجمعة",
      "خطب الجمعه",
      "أرشيف خطب الجمعة",
      "ارشيف خطب الجمعه",
      "أرشيف الخطب",
      "ارشيف الخطب",
      "ارشيڤ الخطب",
      "الأرشيف"
    ])
}

function isWahySnippetQuestion(norm: string): boolean {
  return includesAny(norm, ["من وحي الجمعة", "من وحي الجمعه", "وحي الجمعة", "وحي الجمعه"]) &&
    includesAny(norm, ["مقتطفات", "خطب كاملة", "خطب كامله", "مقتطفات ام", "مقتطفات أم"])
}

function isAbbasWivesQuery(query: string): boolean {
  return resolveSlot(query) === "wife"
}

function isAbbasWifeNameQuery(query: string): boolean {
  if (resolveSlot(query) !== "wife") return false
  const norm = normalizeArabicLight(query)
  return /(?:اسم|ما\s+اسم|من\s+(?:هي|هو))/u.test(norm)
}

function isAbbasWivesFollowUpQuery(norm: string): boolean {
  return includesAny(norm, ["زوجة واحدة", "زوجه واحده", "ام اكثر", "أم أكثر", "واحدة أم أكثر"])
}

function isAbbasTitlesQuery(query: string): boolean {
  const slot = resolveSlot(query)
  return slot === "titles" || slot === "kunya"
}

function isAbbasShortDefinitionQuery(query: string): boolean {
  if (resolveSlot(query) !== "definition") return false
  const norm = normalizeArabicLight(query)
  return /(?:باختصار|سطر\s+واحد|نبذ|تعريف|دون\s+مقدم)/u.test(norm)
}

function isAbbasMartyrdomQuery(query: string): boolean {
  return resolveSlot(query) === "martyrdom"
}

function isAbbasFatherQuery(query: string): boolean {
  return resolveSlot(query) === "father"
}

function isAbbasMotherQuery(query: string): boolean {
  return resolveSlot(query) === "mother"
}

function isAbbasBrothersQuery(query: string): boolean {
  return resolveSlot(query) === "brothers"
}

function isAbbasSistersQuery(query: string): boolean {
  return resolveSlot(query) === "sisters"
}

function isAbbasUnclesQuery(query: string): boolean {
  return resolveSlot(query) === "uncles"
}

function isAbbasAgeQuery(query: string): boolean {
  return resolveSlot(query) === "age"
}

function isAbbasBirthQuery(query: string): boolean {
  return resolveSlot(query) === "birth"
}

function isEducationalProjectQuery(norm: string): boolean {
  const explicitEducationalProjectSignals = includesAny(norm, ["مشروع تعليمي", "مشاريع تعليم", "مشروع تربوي"])
  const namedEducationalEntity =
    includesAny(norm, ["جامعة الكفيل", "العميد التعليمية", "جامعة العميد", "مدارس العميد"]) &&
    includesAny(norm, ["مشروع", "تعليمي", "تربوي", "للعتبة", "تابع"])

  return explicitEducationalProjectSignals || namedEducationalEntity
}

function isMedicalProjectQuery(norm: string): boolean {
  return includesAny(norm, [
    "مشروع طبي",
    "مشروع صحي",
    "المشاريع الطبيه",
    "المشاريع الطبية",
    "المشاريع الصحيه",
    "المشاريع الصحية",
    "قطاع طبي",
    "قطاع صحي",
    "مستشفى",
    "مستشفى الكفيل",
    "الرعاية الصحية"
  ])
}

/**
 * Returns true when the user explicitly asks for a listing of the latest
 * posts/news/items (e.g. "اعرض لي آخر منشورين من قسم مستشفى الكفيل").
 * Such queries must always go through the retrieval pipeline rather than
 * being short-circuited by a canned definitional answer.
 */
function isExplicitLatestListingRequest(norm: string): boolean {
  const hasLatestPlural = /(?:اخر|آخر|أحدث|احدث)\s+(?:\d+\s+)?(?:منشور|منشورين|منشورات|اخبار|أخبار|خبر|خبرين|مقال|مقاله|مقالات|فيديو|فيديوهات|بيان|بيانات|اعلان|إعلان|اعلانات|إعلانات|تصاريح|تصريح|نشاطات|نشاط|فعاليات|فعاليه)/u.test(norm)
  const hasNumericLatest = /(?:اخر|آخر|أحدث|احدث)\s+\d+/u.test(norm)
  // Also treat "display verb + plural media type" as an explicit listing request
  // so "اعرض لي فيديوهات مستشفى الكفيل" bypasses canned answers.
  const hasDisplayVerb = /(?:اعرض|ارني|أرني|احضر|أحضر|اجلب|جيب|هات)(?:\s+لي)?/u.test(norm)
  const hasPluralMediaType = /(?:فيديوهات|مقاطع|تسجيلات|اخبار|أخبار|مقالات|منشورات|محاضرات)/u.test(norm)
  return hasLatestPlural || hasNumericLatest || (hasDisplayVerb && hasPluralMediaType)
}

function isProjectListThreeQuery(norm: string): boolean {
  return includesAny(norm, ["3 مشاريع", "ثلاث مشاريع", "اذكر لي 3 مشاريع", "اذكر ثلاث مشاريع"])
}

function isProjectNamesOnlyQuery(norm: string): boolean {
  return includesAny(norm, ["اسماء المشاريع فقط", "أسماء المشاريع فقط", "دون عناوين", "دون روابط"])
}

function isProjectsVsNewsDifferenceQuery(norm: string): boolean {
  return includesAny(norm, ["الفرق بين مشاريع", "مشاريع العتبة واخبار العتبة", "مشاريع العتبة وأخبار العتبة"])
}

function hasSiteServicesSignal(norm: string): boolean {
  return includesAny(norm, [
    "الخدمات الالكترونية",
    "الخدمات الإلكترونية",
    "خدمات الموقع",
    "للزائر"
  ])
}

function isSiteServicesOverviewQuery(norm: string): boolean {
  return hasSiteServicesSignal(norm) && includesAny(norm, ["ما هي", "ابرز", "أبرز", "يقدم", "يوفر"])
}

function isProxyVisitHowToQuery(norm: string): boolean {
  return includesAny(norm, ["الزيارة بالنيابة", "زياره بالنيابه"]) &&
    includesAny(norm, ["كيف", "خطوه", "خطوة", "استخدم", "تسجيل", "التسجيل", "طريقة"])
}

function isProxyWorshipAlternativeQuery(norm: string): boolean {
  return includesAny(norm, ["بالنيابه", "بالنيابة"]) &&
    includesAny(norm, ["دعاء", "ختمه", "ختمة", "عمل عبادي", "غير الزيارة"])
}

function isLiveBroadcastQuery(norm: string): boolean {
  return includesAny(norm, ["بث مباشر", "البث المباشر", "متابعه البث", "متابعة البث"])
}

function isPrayerTimesQuery(norm: string): boolean {
  return includesAny(norm, ["اوقات الصلاة", "أوقات الصلاة", "المواقيت", "مواقيت"])
}

function isFiqhQuestionsSectionQuery(norm: string): boolean {
  return includesAny(norm, ["الاسئله الشرعيه", "الأسئلة الشرعية", "استفتاء", "استفتاءات"])
}

function isMillionVisitServicesQuery(norm: string): boolean {
  return includesAny(norm, ["الزيارات المليونية", "الزيارات المليونيه", "زيارة الاربعين", "زياره الاربعين"]) &&
    includesAny(norm, ["خدمات", "ابرز الخدمات", "أبرز الخدمات"])
}

function isDonationSupportQuery(norm: string): boolean {
  if (includesAny(norm, ["عمل قسم", "ما عمل قسم", "دور قسم"])) return false
  return includesAny(norm, ["تبرع", "التبرع", "دعم", "النذور", "الهدايا والنذور"])
}

function isSiteMainSectionsQuery(norm: string): boolean {
  return includesAny(norm, ["اقسام موقع الكفيل", "أقسام موقع الكفيل", "الاقسام الرئيسية", "الأقسام الرئيسية"])
}

function isSearchHowToQuery(norm: string): boolean {
  return includesAny(norm, ["كيف ابحث", "كيف أبحث", "ابحث في موقع الكفيل", "البحث في الموقع"])
}

function isLibraryBooksQuery(norm: string): boolean {
  return includesAny(norm, ["المكتبه", "المكتبة", "الكتب", "كتاب", "مؤلفات", "اين اجد المكتبة", "أين أجد المكتبة"])
}

function isTranslationWordsQuery(norm: string): boolean {
  return includesAny(norm, [
    "ترجمة كلمات الموقع",
    "ترجمه كلمات الموقع",
    "ترجمة كلمات",
    "ترجمه كلمات",
    "ترجمة مصطلحات",
    "ترجمه مصطلحات",
    "معاني كلمات",
    "معاني مصطلحات",
    "قاموس الموقع",
    "قاموس مصطلحات العتبة",
    "قاموس مصطلحات",
    "مصطلحات العتبة"
  ])
}

function isFridaySermonVideoAvailabilityQuery(norm: string): boolean {
  return includesAny(norm, [
    "هل يوجد فيديو لخطبة الجمعة",
    "هل يوجد فيديو لخطبه الجمعه",
    "هل توجد فيديوهات لخطبة الجمعة",
    "فيديو لخطبة الجمعة",
    "فيديوهات خطبة الجمعة",
    "فيديو لخطب الجمعة"
  ])
}

function isImamaWeekQuery(norm: string): boolean {
  return includesAny(norm, ["اسبوع الامامه", "أسبوع الإمامة", "اسبوع الإمامة", "أسبوع الامامه"])
}

function isWomenEventsQuery(norm: string): boolean {
  return includesAny(norm, ["الشؤون النسويه", "الشؤون النسوية", "فعاليات خاصة بالنساء", "فعاليات للنساء"])
}

function isWomenOfficeRoleQuery(norm: string): boolean {
  return includesAny(norm, ["مكتب المتولي الشرعي للشؤون النسوية", "دور مكتب المتولي الشرعي للشؤون النسوية", "الشؤون النسوية"]) &&
    includesAny(norm, ["دور", "وظيف", "مهام", "ما دور"])
}

function isFrequentOccasionsCoverageQuery(norm: string): boolean {
  return includesAny(norm, ["المناسبات الدينية", "مناسبات دينيه", "بشكل متكرر", "تغطيها شبكة الكفيل"])
}

function isAgricultureProjectQuery(norm: string): boolean {
  return includesAny(norm, ["مشاريع زراعيه", "مشاريع زراعية", "مشاتل", "زراعي"])
}

function isIndustrialProjectQuery(norm: string): boolean {
  return includesAny(norm, ["مصانع", "مصنع", "صناعي", "صناعية", "مشاريع صناعيه", "مشاريع صناعية"])
}

function isUniversityExistenceQuery(norm: string): boolean {
  return (
    includesAny(norm, ["هل لدى العتبة", "هل للعتبة", "هل لدى العتبه", "هل للعتبه"]) &&
    includesAny(norm, ["جامعة", "جامعه", "جامعات"])
  )
}

function isDevelopmentSelfSufficiencyQuery(norm: string): boolean {
  return includesAny(norm, ["التنميه", "التنمية", "الاكتفاء", "الانتاج", "الإنتاج"])
}

function isMajorServiceProjectsQuery(norm: string): boolean {
  return includesAny(norm, ["ابرز المشاريع الخدميه", "أبرز المشاريع الخدمية", "المشاريع الخدميه", "المشاريع الخدمية"])
}

function isConstructionBeyondExpansionQuery(norm: string): boolean {
  return includesAny(norm, ["مشاريع عمرانيه", "مشاريع عمرانية", "غير التوسعه", "غير التوسعة"])
}

function isClassifyProjectTypeCapabilityQuery(norm: string): boolean {
  return includesAny(norm, ["اذا ذكرت لك اسم مشروع", "إذا ذكرت لك اسم مشروع", "تعليمي ام طبي", "تعليمي أم طبي"])
}

function isTopProjectsShortQuery(norm: string): boolean {
  return includesAny(norm, ["اهم المشاريع", "أهم المشاريع", "ابرز المشاريع", "أبرز المشاريع"])
}

function isThreeAffiliatedEntitiesQuery(norm: string): boolean {
  return includesAny(norm, ["3 جهات", "ثلاث جهات", "ثلاثة جهات"]) &&
    includesAny(norm, ["وظيفه", "وظيفة", "تابعه للعتبه", "تابعة للعتبة"])
}

function isShrineAreaQuery(norm: string): boolean {
  return includesAny(norm, ["مساحة الصحن العباسي", "مساحه الصحن العباسي"])
}

function isExpansionWorksQuery(norm: string): boolean {
  return includesAny(norm, ["اعمال التوسعه", "أعمال التوسعة", "توسعة العتبة", "توسعه العتبه"])
}

function isGiftAndVowsSectionQuery(norm: string): boolean {
  return includesAny(norm, ["قسم الهدايا والنذور", "الهدايا والنذور", "عمل قسم الهدايا"])
}

function isMaarefSectionQuery(norm: string): boolean {
  return includesAny(norm, ["قسم المعارف", "شؤون المعارف الاسلاميه", "شؤون المعارف الإسلامية"])
}

function isArtProductionCenterQuery(norm: string): boolean {
  return includesAny(norm, ["مركز الانتاج الفني", "مركز الإنتاج الفني"])
}

function isUniversityDifferenceQuery(norm: string): boolean {
  return includesAny(norm, ["الفرق بين جامعه الكفيل", "الفرق بين جامعة الكفيل", "جامعة العميد", "مجموعة العميد"])
}

function isKnowAlAmeedGroupQuery(norm: string): boolean {
  return includesAny(norm, ["تعرف مجموعة العميد", "هل تعرف مجموعة العميد", "ما هي مجموعة العميد"])
}

function isSchoolsAffiliationQuery(norm: string): boolean {
  return includesAny(norm, ["مدارس تابعه", "مدارس تابعة", "مدارس للعتبة"])
}

function isResearchCentersQuery(norm: string): boolean {
  return includesAny(norm, [
    "مراكز بحثيه",
    "مراكز بحثية",
    "المراكز البحثيه",
    "المراكز البحثية",
    "مراكز فكرية",
    "المراكز الفكرية",
    "مركز التأليف",
    "مراكز التاليف",
    "مراكز التأليف"
  ])
}

function isAcademicPublicationsQuery(norm: string): boolean {
  return includesAny(norm, ["اصدارات اكاديميه", "إصدارات أكاديمية", "سلاسل علميه", "سلاسل علمية"])
}

function isUniversityProgramsQuery(norm: string): boolean {
  return includesAny(norm, ["نشاطات خاصة بطلبة الجامعات", "برامج للجامعات", "طلبة الجامعات"])
}

function isCulturalActivitiesQuery(norm: string): boolean {
  return includesAny(norm, ["الانشطه الثقافيه", "الأنشطة الثقافية", "فعالية ثقافية", "فعاليات ثقافية"]) &&
    includesAny(norm, ["العتبه العباسيه", "العتبة العباسية", "تعلن عنها", "ابرز"])
}

function isMourningCouncilsProgramsQuery(norm: string): boolean {
  return includesAny(norm, ["مجالس عزاء", "مجالس العزاء", "برامج احياء", "برامج إحياء", "مناسبات دينية"]) &&
    includesAny(norm, ["هل لدى العتبة", "العتبه العباسيه", "العتبة العباسية"])
}

function isWhereFindVideosQuery(norm: string): boolean {
  return includesAny(norm, ["اين اجد الفيديوهات", "أين أجد الفيديوهات", "الفيديوهات التابعة", "قسم الفيديو"])
}

function isVideoSectionsListQuery(norm: string): boolean {
  return (
    includesAny(norm, ["اقسام الفيديو", "أقسام الفيديو", "اقسام المكتبه المرئيه", "أقسام المكتبة المرئية",
      "تصنيفات الفيديو", "انواع الفيديو", "أنواع الفيديو", "فئات الفيديو"]) &&
    !includesAny(norm, ["اين تقع", "أين تقع", "موقع المرقد"])
  )
}

function isAliSharifiQuery(norm: string): boolean {
  return includesAny(norm, ["من هو علي الشريفي", "علي الشريفي"])
}

function isOutOfDomainCelebrityQuery(norm: string): boolean {
  return includesAny(norm, [
    "كريستيانو رونالدو",
    "كرستيانو رونالدو",
    "ronaldo",
    "messi",
    "ليونيل ميسي",
    "الدوري الانجليزي",
    "الدوري الإنجليزي",
    "premier league"
  ])
}

export function isOfficeHolderFactQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  return hasOfficeHolderSignal(norm)
}

export function isAbbasChildrenQuery(text: string): boolean {
  return resolveSlot(text) === "children"
}

function isAbbasBiographyWhoIsQuery(text: string): boolean {
  // Paraphrase-robust: only the pure "who is Abbas" definition slot.
  // Attribute-targeted phrasings (wife/father/children/...) resolve to
  // their own slot via detectAbbasRelationSlot's priority order.
  return resolveSlot(text) === "definition"
}

/**
 * Returns a hard-coded direct answer for queries with known answers, or null.
 *
 * @param query       Raw user query
 * @param understanding Optional — when provided and contains a pre-resolved
 *                    person_relation_slot (e.g. from LLMIntentResolver), that
 *                    slot is used in place of the regex detector so typo-affected
 *                    queries are handled correctly.
 */
export function getDeterministicDirectAnswer(
  query: string,
  understanding?: { person_relation_slot?: PersonRelationSlot | null },
): string | null {
  // Set ambient slot for this synchronous invocation.
  _ambientSlot = understanding?.person_relation_slot !== undefined
    ? understanding.person_relation_slot
    : undefined
  try {
    return _getDeterministicDirectAnswerInner(query)
  } finally {
    _ambientSlot = undefined
  }
}

function _getDeterministicDirectAnswerInner(query: string): string | null {
  const norm = normalizeArabicLight(query)

  // "هل للعتبة العباسية جامعة" / "هل لدى العتبة جامعة" → ground-truth answer.
  // The shrine has multiple affiliated universities/educational institutions
  // (most notably جامعة الكفيل and جامعة العميد). Returning a deterministic
  // answer prevents the LLM from hallucinating "لا تمتلك جامعة" based on
  // partial article snippets.
  if (isUniversityExistenceQuery(norm)) {
    return [
      "نعم، للعتبة العباسية المقدسة عدة مؤسسات تعليمية جامعية تابعة لها أو منبثقة عنها، أبرزها:",
      "- **جامعة الكفيل**: جامعة أهلية في النجف الأشرف ضمن مجموعة الكفيل التابعة للعتبة.",
      "- **جامعة العميد**: جامعة أهلية في كربلاء المقدسة تابعة لمجموعة العميد للعتبة العباسية.",
      "كما تضم العتبة مدارس العميد ومراكز تعليمية أخرى."
    ].join("\n")
  }

  return null
}

export function getSafeCapabilityDirectAnswer(_query: string): string | null {
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
  const baseInstruction =
    "تعليمات شكل الإجابة: لا تبدأ بعبارة (بحسب ما ورد في المصادر). إذا ذكرت رابطًا فاكتبه بصيغة [المصدر](url) ولا تعرض الرابط الخام داخل النص. عند عرض أكثر من نتيجة اجعل العنوان في سطر مستقل وغامقًا، ثم اكتب المتن في السطر التالي باختصار واضح."

  if (twoLines) {
    return `${baseInstruction} أجب في سطرين فقط كحد أقصى، دون قوائم أو روابط أو عناوين، وبدون جملة ختامية من نوع (هل تريد تفاصيل أكثر).`
  }
  if (directOnly) {
    return `${baseInstruction} أعطِ الجواب المباشر فقط في جملة واحدة قصيرة، دون قوائم أو روابط أو عناوين، وبدون جملة ختامية من نوع (هل تريد تفاصيل أكثر).`
  }

  return baseInstruction
}
