// Matches a citizen asking in their own words for a link into the web
// portal ("magic link", "send me a link", "web link", "portal please").
// Handled deterministically rather than left to the agent — asked to call
// get_report_link, the thinking-disabled model twice fabricated a fake
// link instead of actually calling the tool (a full invented
// "janreport.example.com" URL once, a bare literal "<link>" placeholder
// the next time). A citizen clicking a hallucinated URL is a much worse
// outcome than a slightly over-eager regex, so this intent never reaches
// the LLM at all.
// Any mention of a link counts. The earlier pattern list required a verb
// ("send me a link") or a qualifier ("web link"), so a citizen answering
// the bot's own offer with "Yes link" or "Link of existing" fell through to
// the agent — which then asked which report they meant, asked again, and
// finally replied with the greeting, losing the thread entirely. Seen in a
// real conversation.
//
// "link road" is excluded: that is ordinary Indian English for a connecting
// road, so it is far likelier to appear while describing where a pothole is
// than in a request for the portal.
const LINK_REQUEST_RE = /\blinks?\b(?!\s*road\b)/i;

export function isLinkRequest(text: string): boolean {
  return LINK_REQUEST_RE.test(text);
}
