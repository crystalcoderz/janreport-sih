// janreport.xyz exists only to hand a citizen straight to the WhatsApp bot,
// so every path and query on the apex redirects to the same chat link. The
// prefilled "Hi" matters: it matches GREETING_RE in the reporting webhook,
// which is what triggers the welcome poster, voice notes and quick-report
// buttons instead of a cold empty chat.
const TARGET = "https://wa.me/31653826705?text=Hi";

const worker = {
  fetch() {
    return Response.redirect(TARGET, 301);
  },
};

export default worker;
