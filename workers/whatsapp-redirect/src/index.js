// janreport.xyz is the public, shareable name; the app itself is served from
// janreport.prayaas.us. Path and query are preserved so a deep link posted
// anywhere (a specific report, the map) survives the hop.
const TARGET_ORIGIN = "https://janreport.prayaas.us";

const worker = {
  fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, TARGET_ORIGIN);
    // 302, not 301: browsers cache permanent redirects aggressively and this
    // target is the kind of thing that moves. A wrong 301 is very hard to
    // take back from someone who has already visited.
    return Response.redirect(target.toString(), 302);
  },
};

export default worker;
