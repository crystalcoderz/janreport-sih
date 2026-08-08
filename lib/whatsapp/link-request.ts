// Matches a citizen asking in their own words for a link into the web
// portal ("magic link", "send me a link", "web link", "portal please").
// Handled deterministically rather than left to the agent — asked to call
// get_report_link, the thinking-disabled model twice fabricated a fake
// link instead of actually calling the tool (a full invented
// "janreport.example.com" URL once, a bare literal "<link>" placeholder
// the next time). A citizen clicking a hallucinated URL is a much worse
// outcome than a slightly over-eager regex, so this intent never reaches
// the LLM at all.
const LINK_REQUEST_RE =
  /\b(magic link|(send|get|share|give)\s+(me\s+)?(a\s+|the\s+)?(magic\s+)?(web\s+|browser\s+|portal\s+)?link|(web|browser|portal)\s+link)\b/i;

export function isLinkRequest(text: string): boolean {
  return LINK_REQUEST_RE.test(text);
}
