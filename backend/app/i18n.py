"""Built-in interface strings: key → (English, Urdu).

Administrators override any of these per language from Configuration → Languages & translations; overrides are
stored in the `translations` table. Additional languages start from English and are translated in the same screen.
The frontends call t(key, englishFallback), and a test checks that every key they use is listed here.
"""

CATALOG: dict[str, tuple[str, str]] = {
    # common
    "common.save": ("Save", "محفوظ کریں"),
    "common.cancel": ("Cancel", "منسوخ کریں"),
    "common.search": ("Search", "تلاش کریں"),
    "common.loading": ("Loading…", "لوڈ ہو رہا ہے…"),
    "common.view_all": ("View all", "سب دیکھیں"),
    "common.read_more": ("Read more", "مزید پڑھیں"),
    "common.back": ("Back", "واپس"),
    "common.language": ("Language", "زبان"),
    "common.submit": ("Submit", "جمع کرائیں"),
    "common.close": ("Close", "بند کریں"),
    # portal navigation
    "nav.dashboard": ("Dashboard", "ڈیش بورڈ"),
    "nav.directory": ("Directory", "ڈائریکٹری"),
    "nav.community": ("Community", "کمیونٹی"),
    "nav.events": ("Events", "تقریبات"),
    "nav.jobs": ("Jobs", "ملازمتیں"),
    "nav.mentorship": ("Mentorship", "رہنمائی"),
    "nav.messages": ("Messages", "پیغامات"),
    "nav.news": ("News", "خبریں"),
    "nav.admin": ("Administration", "انتظامیہ"),
    # user menu
    "menu.my_profile": ("My profile", "میری پروفائل"),
    "menu.my_network": ("My network", "میرا نیٹ ورک"),
    "menu.achievements": ("Achievements", "کامیابیاں"),
    "menu.giving": ("Donations & giving", "عطیات"),
    "menu.gallery": ("Gallery", "گیلری"),
    "menu.notifications": ("Notifications", "اطلاعات"),
    "menu.account": ("Account settings", "اکاؤنٹ کی ترتیبات"),
    "menu.security": ("Security", "سیکیورٹی"),
    "menu.sign_out": ("Sign out", "سائن آؤٹ"),
    "menu.admin_panel": ("Admin panel", "ایڈمن پینل"),
    "menu.portal": ("Alumni portal", "ایلومنائی پورٹل"),
    # auth
    "auth.sign_in": ("Sign in", "سائن ان"),
    "auth.sign_in_title": ("Sign in to your account", "اپنے اکاؤنٹ میں سائن ان کریں"),
    "auth.email": ("Email address", "ای میل ایڈریس"),
    "auth.password": ("Password", "پاس ورڈ"),
    "auth.forgot": ("Forgot password?", "پاس ورڈ بھول گئے؟"),
    "auth.no_account": ("New here?", "نئے ہیں؟"),
    "auth.register": ("Join the alumni network", "ایلومنائی نیٹ ورک میں شامل ہوں"),
    "auth.register_title": ("Create your alumni account", "اپنا ایلومنائی اکاؤنٹ بنائیں"),
    "auth.have_account": ("Already registered?", "پہلے سے رجسٹرڈ ہیں؟"),
    "auth.remember": ("Keep me signed in", "مجھے سائن ان رکھیں"),
    # dashboard
    "dashboard.welcome": ("Welcome back", "خوش آمدید"),
    "dashboard.upcoming_events": ("Upcoming events", "آنے والی تقریبات"),
    "dashboard.latest_jobs": ("Latest jobs", "تازہ ترین ملازمتیں"),
    "dashboard.community": ("From the community", "کمیونٹی سے"),
    "dashboard.quick_actions": ("Quick actions", "فوری اقدامات"),
    # public website
    "site.home": ("Home", "ہوم"),
    "site.about": ("About", "تعارف"),
    "site.news": ("News", "خبریں"),
    "site.events": ("Events", "تقریبات"),
    "site.gallery": ("Gallery", "گیلری"),
    "site.distinguished": ("Distinguished alumni", "ممتاز ایلومنائی"),
    "site.success_stories": ("Success stories", "کامیابی کی کہانیاں"),
    "site.contact": ("Contact", "رابطہ"),
    "site.newsletter": ("Newsletter", "نیوز لیٹر"),
    "site.sign_in": ("Sign in", "سائن ان"),
    "site.join": ("Join the network", "نیٹ ورک میں شامل ہوں"),
    "site.portal": ("Alumni Portal", "ایلومنائی پورٹل"),
    "site.upcoming_events": ("Upcoming events", "آنے والی تقریبات"),
    "site.no_events": ("No upcoming events right now.", "فی الحال کوئی آنے والی تقریب نہیں۔"),
    "site.latest_news": ("Latest news", "تازہ ترین خبریں"),
    "site.no_news": ("No news yet.", "ابھی کوئی خبر نہیں۔"),
    "site.photos": ("photos", "تصاویر"),
    "site.no_albums": ("No albums yet.", "ابھی کوئی البم نہیں۔"),
    "site.contact_us": ("Get in touch", "ہم سے رابطہ کریں"),
    "site.contact_intro": (
        "Questions about the alumni network, events or giving? Write to the alumni office.",
        "ایلومنائی نیٹ ورک، تقریبات یا عطیات کے بارے میں سوالات؟ ایلومنائی آفس کو لکھیں۔",
    ),
    "site.your_name": ("Your name", "آپ کا نام"),
    "site.your_email": ("Your email", "آپ کی ای میل"),
    "site.phone_optional": ("Phone (optional)", "فون (اختیاری)"),
    "site.subject": ("Subject", "موضوع"),
    "site.message": ("Message", "پیغام"),
    "site.send": ("Send message", "پیغام بھیجیں"),
    "site.sent": (
        "Thank you — your message has been sent. The alumni office will reply by email.",
        "شکریہ — آپ کا پیغام بھیج دیا گیا ہے۔ ایلومنائی آفس ای میل کے ذریعے جواب دے گا۔",
    ),
    "site.subscribe": ("Subscribe", "سبسکرائب کریں"),
    "site.subscribe_title": ("Stay in touch", "رابطے میں رہیں"),
    "site.subscribe_text": (
        "News, events and stories from the alumni office — a few times a year.",
        "ایلومنائی آفس کی خبریں، تقریبات اور کہانیاں — سال میں چند بار۔",
    ),
    "site.subscribe_done": (
        "Almost done — check your inbox to confirm your subscription.",
        "تقریباً مکمل — اپنی سبسکرپشن کی تصدیق کے لیے ای میل دیکھیں۔",
    ),
    "site.address": ("Address", "پتہ"),
    "site.phone": ("Phone", "فون"),
    "site.email": ("Email", "ای میل"),
    "site.register_event": ("Sign in to register", "رجسٹریشن کے لیے سائن ان کریں"),
    "site.online": ("Online", "آن لائن"),
    "site.all_rights": ("All rights reserved.", "جملہ حقوق محفوظ ہیں۔"),
    "site.not_found": ("Page not found", "صفحہ نہیں ملا"),
    "site.not_found_text": (
        "The page you are looking for does not exist or is no longer published.",
        "آپ جس صفحے کی تلاش میں ہیں وہ موجود نہیں یا اب شائع نہیں ہے۔",
    ),
    "site.go_home": ("Go to the home page", "ہوم پیج پر جائیں"),
    "site.preview_banner": ("Preview — this is how the page will look when published.", "پیش منظر — شائع ہونے پر صفحہ ایسا دکھائی دے گا۔"),
    "site.reconnect": ("Reconnect", "دوبارہ جڑیں"),
    "site.network": ("Network", "نیٹ ورک"),
    "site.mentor": ("Mentor", "رہنمائی"),
    "site.give_back": ("Give back", "واپس لوٹائیں"),
    "site.come_together": ("Come together", "اکٹھے ہوں"),
}


def built_in(language: str) -> dict[str, str]:
    """Defaults for a language: Urdu ships translated; other languages start from English."""
    idx = 1 if language == "ur" else 0
    return {k: v[idx] for k, v in CATALOG.items()}
