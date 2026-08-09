// Matches a citizen abandoning an in-progress report in their own words
// ("cancel", "never mind", "start over"). Handled deterministically rather
// than left to the agent — asked to call cancel_report on a bare "cancel"
// message, the thinking-disabled model didn't call it at all (tools=[],
// confirmed live: the session row was still there afterward). Same failure
// mode already fixed for name capture, link requests, and location/name
// completion, now closed for this intent too.
const CANCEL_REQUEST_RE =
  /\b(cancel|never\s?mind|nevermind|forget (it|that|this)|start over|scrap (it|this)|abort|stop this report)\b/i;

export function isCancelRequest(text: string): boolean {
  return CANCEL_REQUEST_RE.test(text);
}
