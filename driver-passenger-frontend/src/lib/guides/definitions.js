// Phase 3 (A12) — guide scripts. Each guide is short (≤5 steps),
// one plain instruction per step, written for a first-time,
// low-literacy user. `target` is the value of a data-guide
// attribute on the page; a missing target never breaks the guide
// (the step shows without a highlight). Text is inline {en, ur} —
// native Urdu script only — so guides work even where the screen
// itself is not yet dictionary-translated.

export const GUIDES = {
    ridePassenger: [
        {
            target: "ride-pickup",
            en: "This is where you are. Check it is right — the driver will come here.",
            ur: "یہ وہ جگہ ہے جہاں آپ ہیں۔ دیکھ لیں کہ یہ ٹھیک ہے — ڈرائیور یہیں آئے گا۔",
        },
        {
            target: "ride-destination",
            en: "Write where you want to go. You can also tap the mic and speak it.",
            ur: "یہاں لکھیں کہ آپ نے کہاں جانا ہے۔ آپ مائیک دبا کر بول بھی سکتے ہیں۔",
        },
        {
            target: "ride-vehicle",
            en: "Choose your ride — bike, rickshaw or car. The price is shown with each one.",
            ur: "اپنی سواری چنیں — موٹر سائیکل، رکشہ یا گاڑی۔ ہر ایک کے ساتھ کرایہ لکھا ہوتا ہے۔",
        },
        {
            target: "ride-fare",
            en: "You can offer your own fare here. The driver can accept it or offer another.",
            ur: "یہاں آپ اپنا کرایہ بتا سکتے ہیں۔ ڈرائیور اسے مان سکتا ہے یا اپنا کرایہ بتا سکتا ہے۔",
        },
        {
            target: "ride-request",
            en: "Tap this button to send your request. Stay on this screen — your driver will appear here.",
            ur: "درخواست بھیجنے کے لیے یہ بٹن دبائیں۔ اسی سکرین پر رہیں — آپ کا ڈرائیور یہیں نظر آئے گا۔",
        },
    ],

    bdPassenger: [
        {
            target: "bd-list",
            en: "Write everything you want to buy, one thing on each line. Or tap the mic and speak your list.",
            ur: "جو کچھ خریدنا ہے وہ یہاں لکھیں، ہر چیز الگ لائن پر۔ یا مائیک دبا کر اپنی فہرست بولیں۔",
        },
        {
            target: "bd-next",
            en: "When your list is ready, tap Next. Nothing is sent yet — you can still go back.",
            ur: "فہرست تیار ہو جائے تو اگلا دبائیں۔ ابھی کچھ نہیں بھیجا گیا — آپ واپس بھی جا سکتے ہیں۔",
        },
        {
            target: "bd-budget",
            en: "Write the most money the shopping should cost. The partner will stay inside this amount.",
            ur: "یہاں وہ زیادہ سے زیادہ رقم لکھیں جو خریداری پر لگنی چاہیے۔ ساتھی اسی رقم کے اندر رہے گا۔",
        },
        {
            target: "bd-location",
            en: "Tell us where to bring your shopping. Tap \"Use my current location\" if you are at home.",
            ur: "بتائیں کہ سامان کہاں پہنچانا ہے۔ اگر آپ گھر پر ہیں تو ”میری موجودہ جگہ“ دبائیں۔",
        },
        {
            target: "bd-submit",
            en: "Check everything once, then send. Partners nearby will send you their delivery price.",
            ur: "سب کچھ ایک بار دیکھ کر بھیج دیں۔ قریبی ساتھی آپ کو اپنی ڈیلیوری قیمت بھیجیں گے۔",
        },
    ],

    driverRequests: [
        {
            target: "driver-online",
            en: "Keep this ON while you want work. No requests come when you are offline.",
            ur: "جب کام چاہیے تو اسے آن رکھیں۔ آف لائن ہونے پر کوئی درخواست نہیں آتی۔",
        },
        {
            target: "driver-requests",
            en: "New work appears here — rides, parcels and shopping. A sound and banner also tell you, on any screen.",
            ur: "نیا کام یہاں آتا ہے — سواری، پارسل اور خریداری۔ کسی بھی سکرین پر آواز اور بینر بھی آپ کو بتاتے ہیں۔",
        },
        {
            target: "driver-bd-step",
            en: "For shopping, this card always tells you the one thing to do next. Just follow it step by step.",
            ur: "خریداری کے لیے یہ کارڈ ہمیشہ بتاتا ہے کہ اب ایک کام کیا کرنا ہے۔ بس قدم بہ قدم اسی پر چلیں۔",
        },
        {
            target: "driver-bd-chat",
            en: "Talk to the customer here. If you cannot type, send a voice message with the mic.",
            ur: "گاہک سے یہاں بات کریں۔ اگر لکھنا نہ آئے تو مائیک سے آواز کا پیغام بھیجیں۔",
        },
    ],

    rentalPassenger: [
        {
            target: "rental-vehicle",
            en: "These are the cars you can hire. Each card shows the car and its price.",
            ur: "یہ وہ گاڑیاں ہیں جو آپ کرائے پر لے سکتے ہیں۔ ہر کارڈ پر گاڑی اور اس کی قیمت لکھی ہے۔",
        },
        {
            target: "rental-book",
            en: "Tap a car, choose your dates, then tap Request booking. The owner confirms first — you pay the small booking fee after that.",
            ur: "گاڑی چنیں، تاریخیں چنیں، پھر بکنگ کی درخواست دبائیں۔ پہلے مالک تصدیق کرتا ہے — چھوٹی بکنگ فیس اس کے بعد دینی ہوتی ہے۔",
        },
        {
            target: "rental-mode",
            en: "\"With driver\" means the owner sends a driver with the car. Self-drive may not be open yet.",
            ur: "”ڈرائیور کے ساتھ“ کا مطلب ہے کہ مالک گاڑی کے ساتھ ڈرائیور بھیجے گا۔ خود چلانا شاید ابھی کھلا نہ ہو۔",
        },
    ],
};
