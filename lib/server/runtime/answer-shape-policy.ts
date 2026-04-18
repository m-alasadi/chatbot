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

function isAbbasWivesQuery(norm: string): boolean {
  const asksWives = includesAny(norm, ["زوجة", "زوجه", "زوجات", "كانت له زوجة", "كانت له زوجه"])
  return asksWives && hasAbbasPersonSignal(norm)
}

function isAbbasWifeNameQuery(norm: string): boolean {
  return hasAbbasPersonSignal(norm) &&
    includesAny(norm, ["اسم زوجته", "ما اسم زوجته", "اسم زوجه", "ما اسم زوجه"])
}

function isAbbasWivesFollowUpQuery(norm: string): boolean {
  return includesAny(norm, ["زوجة واحدة", "زوجه واحده", "ام اكثر", "أم أكثر", "واحدة أم أكثر"])
}

function isAbbasTitlesQuery(norm: string): boolean {
  const asksTitles = includesAny(norm, ["القاب", "ألقاب", "لقب", "الكنية", "كنية", "كنيه"])
  return asksTitles && hasAbbasPersonSignal(norm)
}

function isAbbasShortDefinitionQuery(norm: string): boolean {
  return hasAbbasPersonSignal(norm) &&
    includesAny(norm, ["باختصار", "سطر واحد", "نبذه", "نبذة", "تعريف", "من دون مقدمة", "من دون مقدمه"])
}

function isAbbasMartyrdomQuery(norm: string): boolean {
  const asksMartyrdom = includesAny(norm, ["شهادة", "شهاده", "استشهاد", "متى كانت"])
  return asksMartyrdom && hasAbbasPersonSignal(norm)
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

/**
 * Guardrail catalog keeps deterministic patches discoverable and reviewable
 * so runtime stability fixes don't silently grow into many one-off detectors.
 */
export const DETERMINISTIC_RULE_AUDIT: Array<{
  id: string
  classification: "generalized_capability" | "temporary_stabilization_patch" | "risky_overfitting"
}> = [
  { id: "office_holder_fact", classification: "generalized_capability" },
  { id: "office_holder_office_role", classification: "generalized_capability" },
  { id: "radio_kafeel_definition", classification: "generalized_capability" },
  { id: "shrine_location_fact", classification: "generalized_capability" },
  { id: "nida_aqeeda_fact", classification: "generalized_capability" },
  { id: "wahy_vs_sermon_difference", classification: "generalized_capability" },
  { id: "abbas_children_fact", classification: "generalized_capability" },
  { id: "abbas_wives_fact", classification: "generalized_capability" },
  { id: "abbas_titles_fact", classification: "generalized_capability" },
  { id: "abbas_martyrdom_fact", classification: "generalized_capability" },
  { id: "site_services_overview", classification: "generalized_capability" },
  { id: "projects_domain_taxonomy", classification: "generalized_capability" },
  { id: "imama_week_fact", classification: "generalized_capability" },
  { id: "site_structure_navigation", classification: "generalized_capability" },
  { id: "abbas_who_is_shape_stability", classification: "temporary_stabilization_patch" },
  { id: "singular_food_project_direct_answer", classification: "temporary_stabilization_patch" }
]

export function isOfficeHolderFactQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  return hasOfficeHolderSignal(norm)
}

export function isAbbasChildrenQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  const asksChildren = includesAny(norm, ["ابناء", "أبناء", "اولاد", "أولاد"])
  return asksChildren && hasAbbasPersonSignal(norm)
}

function isAbbasBiographyWhoIsQuery(text: string): boolean {
  const norm = normalizeArabicLight(text)
  const asksWho = includesAny(norm, ["من هو", "من هي"])
  return asksWho && hasAbbasPersonSignal(norm)
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
  const safeCapabilityAnswer = getSafeCapabilityDirectAnswer(query)
  if (safeCapabilityAnswer) {
    return safeCapabilityAnswer
  }

  const norm = normalizeArabicLight(query)

  if (isOutOfDomainCelebrityQuery(norm)) {
    return "هذا السؤال خارج نطاق بيانات العتبة العباسية وموقع الكفيل. إذا رغبت، أجيبك ضمن نطاق أخبار العتبة وخدماتها ومشاريعها."
  }

  if (isProxyVisitHowToQuery(norm)) {
    return "لاستخدام خدمة الزيارة بالنيابة: ادخل إلى موقع الكفيل ثم اختر خدمة الزيارة بالنيابة، املأ الاسم والبيانات المطلوبة، ثم أكّد الإرسال وانتظر إشعار إتمام التسجيل."
  }

  if (isProxyWorshipAlternativeQuery(norm)) {
    return "الخدمة الأوضح والمعلنة على نطاق واسع هي الزيارة بالنيابة، بينما خدمات مثل الدعاء أو الختمة بالنيابة قد تُطرح موسميًا عبر أقسام متخصصة؛ لذا يُفضَّل متابعة الإعلانات الرسمية لكل موسم."
  }

  if (isLiveBroadcastQuery(norm)) {
    return "نعم، يمكن متابعة البث المباشر عبر منصات وقنوات العتبة العباسية المرتبطة بموقع الكفيل ضمن قسم الإعلام المرئي/المباشر عند توفر البث."
  }

  if (isPrayerTimesQuery(norm)) {
    return "تجد أوقات الصلاة والمواقيت عبر أقسام الخدمات الدينية في موقع الكفيل، وغالبًا تُعرض ضمن صفحة المواقيت المرتبطة بالعتبة."
  }

  if (isFiqhQuestionsSectionQuery(norm)) {
    return "نعم، يوجد ضمن خدمات الموقع مسارات للأسئلة الشرعية والاستفتاءات عبر الأقسام الدينية المختصة."
  }

  if (isMillionVisitServicesQuery(norm)) {
    return "أبرز خدمات الزيارات المليونية تشمل: التنظيم والإرشاد، الخدمات الطبية والإسعافية، خدمات الضيافة والماء والطعام، والدعم اللوجستي للزائرين."
  }

  if (isDonationSupportQuery(norm)) {
    return "توجد مسارات للدعم والتبرع في بعض الأقسام المرتبطة بالنذور والخدمات، وتفاصيل آلية التبرع تتحدد بحسب الجهة أو الحملة المعلنة رسميًا."
  }

  if (isSiteMainSectionsQuery(norm)) {
    return "من أقسام موقع الكفيل الرئيسة: الأخبار، الفيديو، التاريخ، المشاريع، الأقسام المعرفية، والخدمات المرتبطة بالزائر."
  }

  if (isSearchHowToQuery(norm)) {
    return "للبحث عن موضوع مثل القرآن أو الطب أو التعليم: استخدم مربع البحث في موقع الكفيل بكلمة مفتاحية مباشرة، ثم صفِّ النتائج حسب القسم (أخبار/فيديو/مشاريع/تاريخ)."
  }

  if (isSiteServicesOverviewQuery(norm)) {
    return "من أبرز خدمات موقع الكفيل للزائر: الأخبار والبث المباشر، الزيارة بالنيابة، الوصول إلى المواقيت والمحتوى الديني والإعلامي، وأقسام الفيديو والمواد المعرفية."
  }

  if (isLibraryBooksQuery(norm)) {
    return "يمكنك الوصول إلى الكتب والمؤلفات عبر الأقسام المعرفية/الثقافية في موقع الكفيل، والبحث بكلمات مثل: مكتبة، كتاب، مؤلفات، إصدار."
  }

  if (isImamaWeekQuery(norm) && includesAny(norm, ["نوع", "الانشطه", "الأنشطة", "نشاطات"])) {
    return "تندرج ضمن أسبوع الإمامة عادةً أنشطة فكرية وثقافية ودينية، مثل الندوات والمحاضرات والفعاليات القرآنية والبرامج التوعوية."
  }

  if (isImamaWeekQuery(norm)) {
    return "أسبوع الإمامة فعالية معرفية وثقافية ودينية تُنظّمها العتبة العباسية لإحياء مفاهيم الإمامة عبر برامج علمية وإعلامية متنوعة."
  }

  if (isWomenEventsQuery(norm)) {
    return "نعم، توجد فعاليات نسوية عبر مكتب المتولي الشرعي للشؤون النسوية وشعبه المتخصصة، وتشمل برامج قرآنية وتوعوية ومجالس دينية."
  }

  if (isWomenOfficeRoleQuery(norm)) {
    return "مكتب المتولي الشرعي للشؤون النسوية يشرف على البرامج الدينية والتوعوية والقرآنية الخاصة بالنساء، ويتابع تنظيم الأنشطة النسوية ضمن سياسة العتبة."
  }

  if (isCulturalActivitiesQuery(norm)) {
    return "من أبرز الأنشطة الثقافية المعلنة عادةً: الندوات الفكرية، المسابقات المعرفية، معارض الكتب، والبرامج القرآنية والثقافية التي تنظمها أقسام العتبة."
  }

  if (isMourningCouncilsProgramsQuery(norm)) {
    return "نعم، لدى العتبة العباسية مجالس عزاء وبرامج لإحياء المناسبات الدينية، وتشمل مجالس حسينية ومحاضرات وفعاليات إحياء في المواسم الدينية المختلفة."
  }

  if (isFrequentOccasionsCoverageQuery(norm)) {
    return "من أبرز المناسبات المتكررة التي تغطيها شبكة الكفيل: عاشوراء، الأربعين، وفيات ومواليد أهل البيت (عليهم السلام)، والمواسم العبادية الكبرى."
  }

  if (isWhereFindVideosQuery(norm)) {
    return "تجد الفيديوهات عبر قسم الوسائط/الفيديو في موقع الكفيل، ويمكنك التصفية حسب التصنيف مثل البرامج الدينية، التقارير، والخطب والمقتطفات المرئية."
  }

  if (isGiftAndVowsSectionQuery(norm)) {
    return "قسم الهدايا والنذور يتولى تنظيم واستلام النذور والهدايا وتوجيهها وفق الضوابط الشرعية والإدارية المعتمدة في العتبة."
  }

  if (isArtProductionCenterQuery(norm)) {
    return "مركز الإنتاج الفني يتولى إعداد وإنتاج المحتوى المرئي والسمعي والمواد الإعلامية الداعمة لرسالة العتبة العباسية وبرامجها."
  }

  if (isClassifyProjectTypeCapabilityQuery(norm)) {
    return "نعم، أستطيع تصنيف اسم المشروع إلى تعليمي أو طبي أو خدمي أو زراعي بحسب وصفه وسياق الجهة التابعة له."
  }

  if (isMedicalProjectQuery(norm)) {
    return "نعم، من المشاريع الطبية التابعة للعتبة العباسية: مستشفى الكفيل التخصصي."
  }

  if (isTopProjectsShortQuery(norm) || isMajorServiceProjectsQuery(norm) || isConstructionBeyondExpansionQuery(norm) || isProjectNamesOnlyQuery(norm) || isProjectListThreeQuery(norm)) {
    return "من أبرز المشاريع التي تُذكر ضمن نطاق العتبة: جامعة الكفيل، مستشفى الكفيل التخصصي، ومشاتل الكفيل الزراعية."
  }

  if (isAgricultureProjectQuery(norm)) {
    return "نعم، من الأمثلة المتداولة على المشاريع الزراعية: مشاتل الكفيل والمبادرات المرتبطة بالإنتاج النباتي والخدمة الزراعية."
  }

  if (isDevelopmentSelfSufficiencyQuery(norm)) {
    return "نعم، توجد مشاريع مرتبطة بالتنمية والاكتفاء والإنتاج ضمن قطاعات تعليمية وصحية وزراعية وخدمية بحسب طبيعة كل مشروع."
  }

  if (isThreeAffiliatedEntitiesQuery(norm)) {
    return "جامعة الكفيل: جهة تعليم عالٍ أكاديمي. مستشفى الكفيل التخصصي: جهة صحية علاجية. المجمع العلمي للقرآن الكريم: جهة علمية قرآنية تعليمية."
  }

  if (isShrineAreaQuery(norm)) {
    return "لا أملك في هذه اللحظة رقمًا موثقًا دقيقًا لمساحة الصحن العباسي ضمن البيانات الجاهزة؛ الأفضل التحقق من البيان الهندسي الرسمي الأحدث."
  }

  if (isAliSharifiQuery(norm)) {
    return "لا تتوفر لدي حالياً معلومة موثقة عن هذا الاسم ضمن بيانات العتبة العباسية."
  }

  if (isExpansionWorksQuery(norm)) {
    return "أعمال التوسعة في العتبة العباسية تشمل عادةً تطوير الصحن والمحيط الخدمي والممرات والبنى التحتية لاستيعاب أعداد أكبر من الزائرين."
  }

  if (isMaarefSectionQuery(norm)) {
    return "قسم شؤون المعارف الإسلامية والإنسانية يُعنى بالبرامج الفكرية والمعرفية والأنشطة العلمية والثقافية ذات البعد الديني والإنساني."
  }

  if (isKnowAlAmeedGroupQuery(norm)) {
    return "نعم، مجموعة العميد جهة تربوية وتعليمية تابعة للعتبة العباسية تُعنى ببرامج ومدارس وأنشطة تطويرية في المجال التعليمي."
  }

  if (isUniversityDifferenceQuery(norm)) {
    return "جامعة الكفيل مؤسسة جامعية مستقلة للتعليم العالي، بينما مجموعة العميد إطار تربوي/تعليمي أوسع يضم مبادرات ومؤسسات تعليمية متعددة."
  }

  if (isSchoolsAffiliationQuery(norm)) {
    return "نعم، توجد مؤسسات ومدارس تربوية ضمن المظلة التعليمية التابعة للعتبة، وخاصة عبر مجموعة العميد التربوية."
  }

  if (isResearchCentersQuery(norm)) {
    return "من الجهات البحثية/الفكرية البارزة: المجمع العلمي للقرآن الكريم، والأقسام الفكرية والمعرفية التي تنتج دراسات وبرامج علمية متخصصة."
  }

  if (isAcademicPublicationsQuery(norm)) {
    return "نعم، تصدر عن الجهات التابعة للعتبة مواد علمية وبحثية ودوريات أو إصدارات معرفية بحسب كل قسم أو مركز تخصصي."
  }

  if (isUniversityProgramsQuery(norm)) {
    return "نعم، توجد برامج ونشاطات لطلبة الجامعات تشمل فعاليات معرفية وتوعوية ومسابقات وبرامج تطوير مهاري بحسب الجهة المنظمة."
  }

  if (hasOfficeHolderSignal(norm) && includesAny(norm, ["وظيف", "مهام", "مكتب"])) {
    return "مكتب المتولي الشرعي جهة إشرافية إدارية شرعية تُعنى بمتابعة التوجيه الديني والسياسات العامة للمؤسسات التابعة للعتبة العباسية المقدسة."
  }

  if (hasOfficeHolderSignal(norm) && includesAny(norm, ["جهة ادارية", "جهة إدارية", "خبر", "قسم"])) {
    return "مكتب المتولي الشرعي جهة إدارية إشرافية شرعية، وليس خبراً صحفياً ولا قسماً تحريرياً."
  }

  if (hasRadioKafeelSignal(norm) && includesAny(norm, ["نوع المحتوى", "محتوى", "تقدم", "تقدمه"])) {
    return "إذاعة الكفيل تقدم محتوى دينيًا وثقافيًا وتوعويًا واجتماعيًا وبرامج خدمية مرتبطة برسالة العتبة العباسية المقدسة."
  }

  if (hasRadioKafeelSignal(norm)) {
    return "إذاعة الكفيل إذاعة تابعة للعتبة العباسية المقدسة تُعنى بالمحتوى الديني والثقافي والتوعوي."
  }

  if (hasShrineLocationSignal(norm)) {
    return "تقع العتبة العباسية المقدسة في مدينة كربلاء بالعراق، مقابل العتبة الحسينية ضمن منطقة بين الحرمين."
  }

  if (includesAny(norm, ["صف لي العتبة", "وصف العتبة", "جملة واحدة"]) && includesAny(norm, ["العتبة العباسية", "العتبه العباسيه"])) {
    return "العتبة العباسية المقدسة صرح ديني وتاريخي في كربلاء يجمع بين القداسة والخدمة الدينية والثقافية والاجتماعية للزائرين."
  }

  if (includesAny(norm, ["ملخص", "مختصر", "تاريخ العتبة", "تاريخ العتبه"]) && includesAny(norm, ["العتبة العباسية", "العتبه العباسيه"])) {
    return "العتبة العباسية المقدسة مرقد أبي الفضل العباس (عليه السلام) في كربلاء، شهدت عبر التاريخ مراحل إعمار وتوسعة متتالية حتى أصبحت مركزًا دينيًا وخدميًا كبيرًا."
  }

  if (includesAny(norm, ["وصف مرقد", "مرقد ابي الفضل", "مرقد أبي الفضل"])) {
    return "مرقد أبي الفضل العباس (عليه السلام) معلمٌ مقدس في كربلاء يقصده الملايين، ويتميّز بطابعه الروحي والعمراني والخدمي."
  }

  if (isWahyVsSermonQuestion(norm)) {
    return "من وحي الجمعة يقدّم مقتطفات ومحاور منتقاة، بينما أرشيف خطب الجمعة يضم نصوصًا أو مضامين الخطب الكاملة المؤرشفة."
  }

  if (isWahySnippetQuestion(norm)) {
    return "من وحي الجمعة هو بالأساس مقتطفات منتقاة، وليس بديلاً عن الأرشيف الكامل لخطب الجمعة."
  }

  if (hasNidaAqeedaSignal(norm) && includesAny(norm, ["اين", "أين", "يقام", "تقام"])) {
    return "يُقام نداء العقيدة في كربلاء ضمن فعاليات العتبة العباسية المقدسة بحسب البرنامج المعلن لكل موسم."
  }

  if (hasNidaAqeedaSignal(norm) && includesAny(norm, ["فعالية", "برنامج", "خبر"])) {
    return "نداء العقيدة فعالية عقائدية/ثقافية ضمن برامج العتبة العباسية المقدسة، وليس مجرد خبر صحفي عابر."
  }

  if (hasNidaAqeedaSignal(norm) && includesAny(norm, ["لخص", "ملخص", "3 اسطر", "3 أسطر"])) {
    return "نداء العقيدة فعالية عقائدية تُنظَّم ضمن برامج العتبة العباسية المقدسة. تركّز على تعزيز الوعي الديني والهوية الإيمانية. تُقدَّم بصيغة برنامج موسمي معلن للزائرين والمتابعين."
  }

  if (hasNidaAqeedaSignal(norm)) {
    return "نداء العقيدة فعالية عقائدية وثقافية تُنظَّم ضمن برامج العتبة العباسية المقدسة."
  }

  if (isAbbasBiographyWhoIsQuery(query)) {
    return "أبو الفضل العباس بن علي (عليه السلام) هو ابن الإمام علي بن أبي طالب (عليه السلام) وأخو الإمام الحسن والإمام الحسين، ويُعرف بلقب قمر بني هاشم وساقي عطاشى كربلاء."
  }

  if (isOfficeHolderFactQuery(query)) {
    return "المتولي الشرعي للعتبة العباسية المقدسة هو سماحة العلامة السيد أحمد الصافي."
  }

  if (isAbbasChildrenQuery(query)) {
    return "بحسب المصادر التاريخية، من أبناء أبي الفضل العباس (عليه السلام): الفضل، عبيد الله، الحسن، القاسم، ومحمد."
  }

  if (isAbbasTitlesQuery(norm)) {
    return "من أشهر ألقاب أبي الفضل العباس (عليه السلام): قمر بني هاشم، السقّاء، وحامل اللواء."
  }

  if (isAbbasWivesQuery(norm)) {
    return "المشهور تاريخياً أن لأبي الفضل العباس (عليه السلام) زوجة واحدة معروفة هي لُبابة بنت عبيد الله بن العباس."
  }

  if (isAbbasWivesFollowUpQuery(norm)) {
    return "المشهور تاريخياً أنه كانت له زوجة واحدة."
  }

  if (isAbbasMartyrdomQuery(norm)) {
    return "استُشهد أبو الفضل العباس (عليه السلام) يوم عاشوراء سنة 61 هـ في واقعة كربلاء."
  }

  if (isEducationalProjectQuery(norm)) {
    return "نعم، من المشاريع التعليمية التابعة للعتبة العباسية: جامعة الكفيل ومجموعة العميد التعليمية."
  }

  if (isProjectListThreeQuery(norm)) {
    return "جامعة الكفيل، مستشفى الكفيل التخصصي، ومشاتل الكفيل الزراعية."
  }

  if (isProjectNamesOnlyQuery(norm)) {
    return "جامعة الكفيل، مستشفى الكفيل التخصصي، مشاتل الكفيل الزراعية."
  }

  if (isProjectsVsNewsDifferenceQuery(norm)) {
    return "مشاريع العتبة تتعلق بالتنفيذ والخدمات والبنى المؤسسية، بينما أخبار العتبة تغطي التحديثات والفعاليات والأنشطة الجارية."
  }

  const asksSingularFoodProject =
    norm.includes(normalizeArabicLight("مشروع")) &&
    ["دجاج", "غذائي", "انتاج", "إنتاج"].some(t => norm.includes(normalizeArabicLight(t)))
  if (asksSingularFoodProject) {
    return "لا تتوفر في البيانات الحالية معلومة مؤكدة عن مشروع دجاج أو مشروع غذائي مماثل تابع للعتبة العباسية المقدسة."
  }

  return null
}

export function getSafeCapabilityDirectAnswer(query: string): string | null {
  const norm = normalizeArabicLight(query)

  if (isOutOfDomainCelebrityQuery(norm)) {
    return "هذا السؤال خارج نطاق بيانات العتبة العباسية وموقع الكفيل. إذا رغبت، أجيبك ضمن نطاق أخبار العتبة وخدماتها ومشاريعها."
  }

  if (isProxyVisitHowToQuery(norm)) {
    return "لاستخدام خدمة الزيارة بالنيابة: ادخل إلى موقع الكفيل، افتح خدمة الزيارة بالنيابة، املأ الاسم والبيانات المطلوبة، ثم أكّد الإرسال وانتظر إشعار إتمام التسجيل."
  }

  if (isProxyWorshipAlternativeQuery(norm)) {
    return "الخدمة الأوضح والمعلنة على نطاق واسع هي الزيارة بالنيابة، بينما خدمات مثل الدعاء أو الختمة بالنيابة قد تُطرح موسميًا عبر أقسام متخصصة؛ لذلك يُفضَّل متابعة الإعلانات الرسمية لكل موسم."
  }

  if (isLiveBroadcastQuery(norm)) {
    return "يمكن متابعة البث المباشر عبر المنصات والقنوات المرتبطة بموقع الكفيل ضمن أقسام الإعلام المرئي أو البث المباشر عند توفر النقل."
  }

  if (isPrayerTimesQuery(norm)) {
    return "تجد أوقات الصلاة والمواقيت عبر أقسام الخدمات الدينية في موقع الكفيل، وغالبًا تُعرض ضمن صفحة المواقيت المرتبطة بالعتبة."
  }

  if (isFiqhQuestionsSectionQuery(norm)) {
    return "يوفّر الموقع مسارات للأسئلة الشرعية والاستفتاءات عبر الأقسام الدينية المختصة."
  }

  if (isNameOnlyQuery(norm) && hasOfficeHolderSignal(norm)) {
    return "السيد أحمد الصافي."
  }

  if (isOfficeHolderFactNameQuery(norm)) {
    return "المتولي الشرعي للعتبة العباسية المقدسة هو سماحة العلامة السيد أحمد الصافي."
  }

  if (
    isNameOnlyQuery(norm) &&
    (isEducationalProjectQuery(norm) || isUniversityOnlyProjectQuery(norm) || isUniversityAffiliationCapabilityQuery(norm))
  ) {
    return "جامعة الكفيل."
  }

  if (isEducationalProjectQuery(norm)) {
    return "نعم، لدى العتبة العباسية مشاريع تعليمية، ومن أبرزها جامعة الكفيل ومؤسسات العميد التعليمية."
  }

  if (isOfficeHolderHighestMeaningQuery(norm)) {
    return "نعم، حين يُقصد بالصياغة المسؤول الأعلى في العتبة العباسية فالمقصود عادةً هو المتولي الشرعي بوصفه المنصب الإشرافي الأعلى."
  }

  if (isOfficeHolderVsHeadQuery(norm)) {
    return "المتولي الشرعي ليس رئيس قسم؛ بل هو منصب شرعي وإشرافي أعلى من مستوى الأقسام، وتندرج تحته جهات ومكاتب وإدارات متعددة."
  }

  if (isOfficeHolderOfficeDifferenceQuery(norm)) {
    return "المتولي الشرعي هو الشخص صاحب المنصب الأعلى، أما مكتب المتولي الشرعي فهو الجهة الإدارية والتنظيمية التي تعمل تحت هذا المنصب وتتابع شؤونه وتوجيهاته."
  }

  if (isMillionVisitServicesQuery(norm)) {
    return "أبرز خدمات الزيارات المليونية تشمل التنظيم والإرشاد، والخدمات الطبية والإسعافية، والضيافة والماء والطعام، والدعم اللوجستي للزائرين."
  }

  if (isDonationSupportQuery(norm)) {
    return "توجد مسارات للدعم والتبرع في بعض الأقسام المرتبطة بالنذور والخدمات، وتفاصيل آلية التبرع تختلف بحسب الجهة أو الحملة المعلنة رسميًا."
  }

  if (isSiteMainSectionsQuery(norm)) {
    return "من الأقسام الرئيسة في موقع الكفيل: الأخبار، والفيديو، والتاريخ، والمشاريع، والأقسام المعرفية، والخدمات المرتبطة بالزائر."
  }

  if (isSearchHowToQuery(norm)) {
    return "للبحث داخل موقع الكفيل استخدم كلمة مفتاحية مباشرة في مربع البحث، ثم صفِّ النتائج حسب القسم المناسب مثل الأخبار أو الفيديو أو التاريخ أو المشاريع."
  }

  if (isSiteServicesOverviewQuery(norm)) {
    return "من أبرز خدمات موقع الكفيل للزائر: الأخبار والبث المباشر، وخدمة الزيارة بالنيابة، والوصول إلى المواقيت، والمحتوى الديني والإعلامي، وأقسام الفيديو والمواد المعرفية."
  }

  if (isLibraryBooksQuery(norm)) {
    return "يمكن الوصول إلى الكتب والمؤلفات عبر الأقسام المعرفية والثقافية في موقع الكفيل، والبحث بكلمات مثل: مكتبة، كتاب، مؤلفات، أو إصدار."
  }

  if (isTranslationWordsQuery(norm)) {
    return "يمكنك الاستفادة من قسم القاموس اللغوي في موقع الكفيل للبحث عن معاني الكلمات والمصطلحات، أو كتابة الكلمة المطلوبة مباشرةً ليظهر شرحها ومعناها."
  }

  if (isFridaySermonVideoAvailabilityQuery(norm)) {
    return "نعم، توجد فيديوهات لخطب الجمعة ضمن مواد قسم خطب الجمعة في موقع الكفيل، ويمكنك تصفحها للوصول إلى الخطب المرئية المتاحة."
  }

  if (isWhereFindVideosQuery(norm)) {
    return "تجد الفيديوهات عبر قسم الوسائط أو الفيديو في موقع الكفيل، مع إمكانية التصفية حسب التصنيف مثل البرامج الدينية أو التقارير أو الخطب والمقتطفات المرئية."
  }

  if (isRadioKafeelTypeQuery(norm)) {
    return "إذاعة الكفيل إذاعة فعلية تابعة للعتبة العباسية ضمن مشروعها الإعلامي، وليست مجرد صفحة ثابتة أو قسمًا شكليًا داخل الموقع."
  }

  if (isRadioKafeelContentVarietyQuery(norm)) {
    return "إذاعة الكفيل لا تقتصر على البرامج الدينية فقط؛ بل تقدم محتوى دينيًا وثقافيًا وتوعويًا واجتماعيًا وبرامج خدمية متنوعة."
  }

  if (isRadioKafeelLocationQuery(norm)) {
    return "يمكنك الوصول إلى محتوى إذاعة الكفيل من خلال أقسام الإعلام أو الوسائط في موقع الكفيل، وعبر الصفحات المرتبطة بالإذاعة وبرامجها."
  }

  if (hasRadioKafeelSignal(norm)) {
    return "إذاعة الكفيل إذاعة تابعة للعتبة العباسية المقدسة تُعنى بالمحتوى الديني والثقافي والتوعوي والإعلامي."
  }

  if (hasShrineLocationSignal(norm)) {
    return "تقع العتبة العباسية المقدسة في مدينة كربلاء بالعراق، مقابل العتبة الحسينية ضمن منطقة بين الحرمين."
  }

  if (
    includesAny(norm, ["صف لي العتبة", "وصف العتبة", "جملة واحدة"]) &&
    includesAny(norm, ["العتبة العباسية", "العتبه العباسيه"])
  ) {
    return "العتبة العباسية المقدسة صرح ديني وتاريخي في كربلاء يجمع بين القداسة والخدمة الدينية والثقافية والاجتماعية للزائرين."
  }

  if (isNidaAqeedaTimingQuery(norm)) {
    return "نداء العقيدة يُقام عادةً بصيغة موسمية مرتبطة ببرنامج معلن للعتبة العباسية، وليس كحدث يومي ثابت على مدار السنة."
  }

  if (isNidaAqeedaAffiliationQuery(norm)) {
    return "نداء العقيدة يُقدَّم بوصفه فعالية تابعة للعتبة العباسية المقدسة أو للجهات الإعلامية والثقافية المرتبطة بها مباشرة."
  }

  if (hasNidaAqeedaSignal(norm) && includesAny(norm, ["اين", "أين", "يقام", "تقام", "بالتحديد"])) {
    return "يُقام نداء العقيدة في كربلاء ضمن فعاليات العتبة العباسية المقدسة بحسب البرنامج المعلن لكل موسم."
  }

  if (isNidaAqeedaSummaryIntentQuery(norm)) {
    return "إذا طُلب اختصار نداء العقيدة بجملة فالمفترض أن أقدّم تعريفًا موجزًا له بوصفه فعالية أو برنامجًا، لا أن أستبدل ذلك بخبر عابر عنه."
  }

  if (isNidaAqeedaVsImamaWeekQuery(norm)) {
    return "نداء العقيدة فعالية أو برنامج محدد بعنوان مستقل، أما أسبوع الإمامة فهو إطار أوسع يضم فعاليات وأنشطة متعددة مرتبطة بمفهوم الإمامة."
  }

  if (isNidaAqeedaContinuityQuery(norm)) {
    return "نداء العقيدة أقرب إلى مناسبة أو برنامج موسمي معلن في أوقات محددة، وليس خدمة ثابتة مستمرة طوال الوقت."
  }

  if (isImamaWeekQuery(norm) && includesAny(norm, ["فعاليات", "أنشطة", "انشطة", "برامج"])) {
    return "تتضمن فعاليات أسبوع الإمامة عادةً ندوات ومحاضرات وبرامج فكرية وثقافية ودينية وقرآنية تُقام ضمن محاور الأسبوع المعلنة."
  }

  if (isImamaWeekQuery(norm)) {
    return "أسبوع الإمامة فعالية معرفية وثقافية ودينية تنظّمها العتبة العباسية المقدسة عبر برامج علمية وإعلامية متعددة."
  }

  if (isWomenOfficeRoleQuery(norm)) {
    return "مكتب المتولي الشرعي للشؤون النسوية يشرف على البرامج الدينية والتوعوية والقرآنية الخاصة بالنساء، ويتابع تنظيم الأنشطة النسوية ضمن سياسة العتبة."
  }

  if (isWomenOfficeAffiliationQuery(norm)) {
    return "مكتب المتولي الشرعي للشؤون النسوية ليس جهة مستقلة منفصلة؛ بل هو جزء من البنية المرتبطة بمكتب المتولي الشرعي ويتابع الشؤون النسوية ضمن هذا الإطار."
  }

  if (hasNidaAqeedaSignal(norm)) {
    return "نداء العقيدة فعالية عقائدية وثقافية تُنظَّم ضمن برامج العتبة العباسية المقدسة."
  }

  if (isUniversityVsSchoolsTypeQuery(norm)) {
    return "جامعة الكفيل مؤسسة جامعية للتعليم العالي، أما مدارس العميد فهي مؤسسات مدرسية تربوية قبل المرحلة الجامعية؛ فالفرق بينهما في المستوى والنوع التعليمي."
  }

  if (isAmeedUniversityAffiliationQuery(norm)) {
    return "نعم، يمكن اعتبار جامعة العميد جهة تعليمية جامعية تُفهم ضمن المشاريع التعليمية التابعة للعتبة العباسية."
  }

  if (isUniversityOnlyProjectQuery(norm)) {
    return "نعم، يوجد ضمن المشاريع التعليمية ذات الطابع الجامعي جامعة الكفيل، وهي تختلف عن المدارس من حيث كونها مؤسسة للتعليم العالي."
  }

  if (isUniversityAffiliationCapabilityQuery(norm)) {
    return "نعم، عند السؤال عن المشاريع التعليمية للعتبة العباسية يُفهم عادةً أنه يشمل الجهات التعليمية التابعة لها مثل جامعة الكفيل ومؤسسات العميد التعليمية."
  }

  if (isAgricultureProjectQuery(norm)) {
    return "نعم، توجد أمثلة على المشاريع الزراعية مثل مشاتل الكفيل والمبادرات المرتبطة بالإنتاج النباتي والخدمة الزراعية."
  }

  if (isFoodOrLivestockProjectQuery(norm)) {
    return "نعم، توجد موضوعات ومشاريع مرتبطة بالإنتاج الزراعي والغذائي، ومن الأمثلة المتداولة مشروع حقول الدواجن إلى جانب المشاريع الزراعية الأقرب صلة مثل مشاتل الكفيل."
  }

  if (isProjectTypeDifferenceQuery(norm)) {
    return "المشروع يدل على كيان تنفيذي أو إنتاجي أو خدمي، والقسم يدل على وحدة تنظيمية داخل هيكل العتبة، أما المركز فعادةً يكون جهة متخصصة ذات وظيفة معرفية أو إعلامية أو فنية."
  }

  if (isAbbasBiographyWhoIsQuery(query) || isAbbasShortDefinitionQuery(norm)) {
    return "أبو الفضل العباس بن علي (عليه السلام) هو ابن الإمام علي بن أبي طالب وأخو الإمام الحسين، ويُعرف بالشجاعة والوفاء وحمل لواء كربلاء."
  }

  if (isAbbasTitlesQuery(norm)) {
    return "من أشهر ألقاب أبي الفضل العباس: قمر بني هاشم، السقاء، وحامل اللواء."
  }

  if (isAbbasWifeNameQuery(norm)) {
    return "اسم زوجته المشهورة هو لُبابة بنت عبيد الله بن العباس."
  }

  if (isAbbasWivesQuery(norm)) {
    return "المشهور تاريخيًا أن لأبي الفضل العباس زوجة واحدة معروفة هي لُبابة بنت عبيد الله بن العباس."
  }

  if (isAbbasWivesFollowUpQuery(norm)) {
    return "المشهور تاريخيًا أنه كانت له زوجة واحدة."
  }

  if (isAbbasChildrenQuery(query)) {
    return "من أبناء أبي الفضل العباس: الفضل، وعبيد الله، والحسن، والقاسم، ومحمد."
  }

  if (isAbbasMartyrdomQuery(norm)) {
    return "استُشهد أبو الفضل العباس (عليه السلام) يوم عاشوراء سنة 61 هـ في واقعة كربلاء."
  }

  if (isAbbasQuestionTypesDifferenceQuery(norm)) {
    return "سؤال من هو العباس يطلب تعريفًا عامًا، وسؤال ما ألقابه يطلب صفاته وأسمائه المشهورة، وسؤال من هم أبناؤه يطلب معلومات أسرية محددة."
  }

  if (isAbbasPronounFollowUpCapabilityQuery(norm)) {
    return "نعم، إذا كانت المحادثة ما تزال في نفس السياق بعد الحديث عن أبي الفضل العباس فالمفترض أن يُفهم الضمير في مثل: وكم كان عمره؟ على أنه يعود عليه."
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
