import { redirect } from "next/navigation";

// Magic-link sign-in creates the account on first use, so there's no
// separate signup step anymore — send anyone who lands here (old links,
// bookmarks) to the one unified flow.
export default function SignupPage() {
  redirect("/login");
}
