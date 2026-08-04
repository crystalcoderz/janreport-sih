// Citizen-facing translations only (nav, landing page, report flow, my
// reports, issue category names). Officer/admin surfaces (dashboard,
// analytics) intentionally have no Hindi entries — department staff, not
// the accessibility target — so lookups for those keys fall through to
// the English value below via the fallback in useTranslation().

export const en = {
  "nav.report": "Report Issue",
  "nav.myReports": "My Reports",
  "nav.map": "Map",
  "nav.alerts": "Nearby Alerts",
  "nav.volunteer": "Volunteer",
  "nav.leaderboard": "Leaderboard",
  "nav.dashboard": "Dashboard",
  "nav.analytics": "Analytics",
  "nav.signOut": "Sign out",

  "landing.signIn": "Sign in",
  "landing.getStarted": "Get started",
  "landing.goToApp": "Go to app",
  "landing.heroTitle": "See a civic issue? Report it in seconds.",
  "landing.heroSubtitle":
    "Snap a photo, share your location — AI classifies the issue, scores its severity, and routes it to the right municipal department automatically. Track resolution in real time.",
  "landing.ctaReport": "Report an issue",
  "landing.ctaOpenApp": "Open JanReport",
  "landing.ctaViewMap": "View live map",
  "landing.featurePhotoTitle": "Photo + GPS",
  "landing.featurePhotoDesc":
    "Capture the issue with your camera — location is tagged automatically.",
  "landing.featureAiTitle": "AI classification",
  "landing.featureAiDesc":
    "Gemini vision AI categorizes the issue and scores severity instantly.",
  "landing.featureRouteTitle": "Auto-routed",
  "landing.featureRouteDesc":
    "Issues are routed straight to the responsible department — no manual triage.",
  "landing.featureTrackTitle": "Live tracking",
  "landing.featureTrackDesc":
    "Follow your report's status in real time, from reported to resolved.",

  "report.title": "Report a civic issue",
  "report.description":
    "Add a photo and your location — AI handles classification and routing.",
  "report.photoLabel": "Photo",
  "report.locationLabel": "Location",
  "report.shareLocation": "Share current location",
  "report.gettingLocation": "Getting location...",
  "report.noteLabel": "Note (optional)",
  "report.notePlaceholder": "Anything else officers should know?",
  "report.speakNote": "Speak note",
  "report.stop": "Stop",
  "report.listening": "Listening...",
  "report.submit": "Submit report",
  "report.analyzing": "Analyzing with AI...",
  "report.successTitle": "Report submitted",
  "report.routedTo": "Routed to",
  "report.trackThisReport": "Track this report",
  "report.reportAnother": "Report another",
  "report.duplicateTitle": "Looks like this may already be reported",
  "report.upvote": "Upvote",
  "report.submitAsNew": "This is a different issue — submit as new",
  "report.aiConfidence": "AI confidence",
  "report.addPhotoFirst": "Add a photo of the issue first.",
  "report.shareLocationFirst": "Share your location first.",
  "report.reportedSuccess": "Issue reported — thank you!",

  "myReports.title": "My Reports",
  "myReports.description": "Track the status of issues you've reported.",
  "myReports.emptyTitle": "You haven't reported anything yet",
  "myReports.emptyDescription":
    "Spotted a civic issue? Report it and track its resolution here.",
  "myReports.emptyCta": "Report an issue",
  "myReports.enableNotifications": "Enable notifications",

  "category.pothole": "Pothole",
  "category.road_damage": "Road Damage",
  "category.water_supply": "Water Supply",
  "category.drainage_sewage": "Drainage & Sewage",
  "category.electricity_outage": "Electricity Outage",
  "category.streetlight": "Streetlight",
  "category.garbage_waste": "Garbage & Waste",
  "category.pollution": "Pollution",
  "category.traffic_safety": "Traffic & Safety",
  "category.accident": "Accident",
  "category.tree_park": "Trees & Parks",
  "category.other": "Other",
} satisfies Record<string, string>;

export type TranslationKey = keyof typeof en;

export const hi: Partial<Record<TranslationKey, string>> = {
  "nav.report": "समस्या दर्ज करें",
  "nav.myReports": "मेरी रिपोर्ट्स",
  "nav.map": "मानचित्र",
  "nav.alerts": "आस-पास की सूचनाएं",
  "nav.volunteer": "स्वयंसेवक",
  "nav.leaderboard": "लीडरबोर्ड",
  "nav.signOut": "साइन आउट",

  "landing.signIn": "साइन इन करें",
  "landing.getStarted": "शुरू करें",
  "landing.goToApp": "ऐप खोलें",
  "landing.heroTitle": "कोई नागरिक समस्या दिखी? कुछ ही सेकंड में दर्ज करें।",
  "landing.heroSubtitle":
    "फोटो खींचें, अपना स्थान साझा करें — AI समस्या की पहचान करता है, गंभीरता का आकलन करता है, और इसे सही नगर विभाग तक स्वतः भेज देता है। समाधान को वास्तविक समय में ट्रैक करें।",
  "landing.ctaReport": "समस्या दर्ज करें",
  "landing.ctaOpenApp": "JanReport खोलें",
  "landing.ctaViewMap": "लाइव मानचित्र देखें",
  "landing.featurePhotoTitle": "फोटो + GPS",
  "landing.featurePhotoDesc":
    "अपने कैमरे से समस्या की फोटो लें — स्थान स्वतः टैग हो जाता है।",
  "landing.featureAiTitle": "AI वर्गीकरण",
  "landing.featureAiDesc":
    "Gemini Vision AI तुरंत समस्या की श्रेणी और गंभीरता तय करता है।",
  "landing.featureRouteTitle": "स्वतः रूटिंग",
  "landing.featureRouteDesc":
    "समस्याएं सीधे संबंधित विभाग को भेजी जाती हैं — कोई मैन्युअल जांच नहीं।",
  "landing.featureTrackTitle": "लाइव ट्रैकिंग",
  "landing.featureTrackDesc":
    "अपनी रिपोर्ट की स्थिति को दर्ज होने से समाधान तक वास्तविक समय में देखें।",

  "report.title": "नागरिक समस्या दर्ज करें",
  "report.description":
    "एक फोटो और अपना स्थान जोड़ें — AI वर्गीकरण और रूटिंग संभालता है।",
  "report.photoLabel": "फोटो",
  "report.locationLabel": "स्थान",
  "report.shareLocation": "वर्तमान स्थान साझा करें",
  "report.gettingLocation": "स्थान प्राप्त हो रहा है...",
  "report.noteLabel": "नोट (वैकल्पिक)",
  "report.notePlaceholder": "अधिकारियों को और क्या जानना चाहिए?",
  "report.speakNote": "बोलकर नोट करें",
  "report.stop": "रोकें",
  "report.listening": "सुन रहा है...",
  "report.submit": "रिपोर्ट भेजें",
  "report.analyzing": "AI विश्लेषण कर रहा है...",
  "report.successTitle": "रिपोर्ट भेज दी गई",
  "report.routedTo": "भेजा गया",
  "report.trackThisReport": "इस रिपोर्ट को ट्रैक करें",
  "report.reportAnother": "एक और रिपोर्ट करें",
  "report.duplicateTitle": "लगता है यह पहले से दर्ज हो चुका है",
  "report.upvote": "समर्थन करें",
  "report.submitAsNew": "यह एक अलग समस्या है — नई रिपोर्ट भेजें",
  "report.aiConfidence": "AI विश्वसनीयता",
  "report.addPhotoFirst": "पहले समस्या की एक फोटो जोड़ें।",
  "report.shareLocationFirst": "पहले अपना स्थान साझा करें।",
  "report.reportedSuccess": "समस्या दर्ज हो गई — धन्यवाद!",

  "myReports.title": "मेरी रिपोर्ट्स",
  "myReports.description": "आपकी दर्ज समस्याओं की स्थिति यहां ट्रैक करें।",
  "myReports.emptyTitle": "आपने अभी तक कुछ भी दर्ज नहीं किया है",
  "myReports.emptyDescription":
    "कोई नागरिक समस्या दिखी? उसे यहां दर्ज करें और समाधान ट्रैक करें।",
  "myReports.emptyCta": "समस्या दर्ज करें",
  "myReports.enableNotifications": "सूचनाएं सक्षम करें",

  "category.pothole": "गड्ढा",
  "category.road_damage": "सड़क क्षति",
  "category.water_supply": "जल आपूर्ति",
  "category.drainage_sewage": "जल निकासी व सीवरेज",
  "category.electricity_outage": "बिजली कटौती",
  "category.streetlight": "स्ट्रीटलाइट",
  "category.garbage_waste": "कचरा प्रबंधन",
  "category.pollution": "प्रदूषण",
  "category.traffic_safety": "यातायात सुरक्षा",
  "category.accident": "दुर्घटना",
  "category.tree_park": "पेड़ व पार्क",
  "category.other": "अन्य",
};
