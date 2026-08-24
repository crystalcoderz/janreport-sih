-- Municipal contact directory, seeded from official government sources.
--
-- Every address below was read off the body's own site or an official
-- government portal, and source_url points at that page. None was constructed
-- from a pattern. Where a page was internally inconsistent, the note says how
-- it was resolved.
--
-- verified = true means: the address is real, it is published by the body, and
-- it is an appropriate destination for a citizen's civic complaint. Only these
-- are ever written to. Rows with verified = false are kept because the research
-- is worth having, but they are inert until a human flips the flag.
--
-- radius_km is a blunt instrument: real jurisdiction is a polygon, not a
-- circle. The radii here are deliberately conservative, so a report near a
-- boundary gets NO office rather than the wrong one. Widen them only if you
-- are comfortable with the overlap that creates.

insert into municipal_offices
  (jurisdiction, name, contact_email, source_url, quoted_context, verified,
   grievance_portal_url, notes, lat, lng, radius_km)
values

-- Greater Noida. Note there is no "Greater Noida Nagar Nigam" -- no municipal
-- corporation exists here. GNIDA discharges the municipal functions itself
-- under the U.P. Industrial Area Development Act, through its Urban Services,
-- Health/Solid Waste and Horticulture departments.
('greater-noida',
 'Greater Noida Industrial Development Authority (GNIDA)',
 'authority@gnida.in',
 'https://gnida.up.gov.in/en/page/contact-us',
 'Email Id  authority[at]gnida[dot]in -- published in the Contact Details block and repeated in the site-wide footer; the page''s own hyperlink resolves to mailto:authority@gnida.in',
 true,
 'https://jansunwai.up.nic.in/',
 'Only email address GNIDA publishes anywhere on its site; a general Authority inbox, not a grievance cell, so expect no ticket number or SLA. GNIDA publishes no grievance portal of its own and routes citizens to the UP state Jansunwai/IGRS system, which does issue a tracked reference -- prefer that as the primary channel and treat email as a parallel copy. Canonical domain is now gnida.up.gov.in; the old greaternoidaauthority.in has an expired certificate. The grievance host grievances.greaternoidaauthority.in no longer resolves (confirmed) despite still being advertised in search results. Corroborated on the district NIC portal gbnagar.nic.in. Do not use kuldeepkumar@gnida.in -- that is a named individual, the Web Information Manager.',
 28.4744, 77.5040, 18),

-- Noida. The official contact page contradicts itself: the visible text says
-- .com, the mailto: href on the same anchor says .in. DNS settles it --
-- noidaauthorityonline.com has live Google Workspace MX records and the .in
-- variant has none at all, so mail to .in would go nowhere. Using .com.
('noida',
 'New Okhla Industrial Development Authority (Noida Authority)',
 'noida@noidaauthorityonline.com',
 'https://noidaauthorityonline.in/en/page/reach-us-',
 'Mailing Address (New Okhla Industrial Development Authority) | Main Administrative Office, H-01, Sector 96, Noida, Gautam Budh Nagar, Uttar Pradesh 201301 | noida@noidaauthorityonline.com',
 true,
 'https://noidaforcitizens.com/Home/Complaint',
 'Do not "correct" this to .in -- the .in domain has no MX records and mail to it is lost. The Authority routes civic grievances to its own portal (noidaforcitizens.com, titled "Grievance Redressal System", footer "Copyright - Noida Authority"), which is the channel it actually publishes for the purpose; email is a secondary copy. Corroborated on the district NIC portal gbnagar.nic.in. Noida and Greater Noida are separate bodies -- do not conflate them.',
 28.5355, 77.3910, 12),

-- Ghaziabad. A Gmail address, but genuinely the one the corporation publishes
-- on its own site. is_official_domain refers to the source page, not the
-- mailbox.
('ghaziabad',
 'Nagar Nigam Ghaziabad (Ghaziabad Municipal Corporation)',
 'gzb.nagar.nigam@gmail.com',
 'https://ghaziabadnagarnigam.in/contact-us.aspx',
 'General Enquiries: gzb.nagar.nigam@gmail.com -- listed with Head Office "Navyug Market, Opp. Old Bus Stand, Ghaziabad - 201001 (U.P.)" and phones 1800 1803 012, 0120-2790369, 0120-2791418',
 true,
 'https://jansunwai.up.nic.in/',
 'Labelled "General Enquiries", not a grievance inbox -- the corporation publishes no complaint-specific address. Being a free Gmail account there is no government-domain guarantee, no delivery receipt and no statutory duty to act, so treat email here as low-reliability. The corporation''s own complaint portal gnnpgrs.in is DEAD (NXDOMAIN, confirmed) even though its IT Department page still directs citizens there. Prefer UP Jansunwai, which is live and issues a trackable number.',
 28.6692, 77.4538, 14),

-- Mathura-Vrindavan. Covers the GLA University area.
('mathura',
 'Nagar Nigam Mathura-Vrindavan (Mathura Vrindavan Municipal Corporation)',
 'nagarayuktmathura@gmail.com',
 'https://www.nnmvonline.in/contactus.aspx',
 'Published on the corporation''s official Contact Us page as the Nagar Ayukt (Municipal Commissioner) contact address',
 true,
 'https://nnmvonline.in/User/PostComplaint.aspx',
 'A Gmail address, but the one published on the corporation''s own site; same reliability caveats as Ghaziabad. The corporation does run its own complaint form (PostComplaint.aspx), which is preferable to email where a citizen can use it.',
 27.4924, 77.6737, 20),

-- Lucknow. On a genuine government domain, unlike Ghaziabad and Mathura.
('lucknow',
 'Lucknow Nagar Nigam (Lucknow Municipal Corporation)',
 'nnlko@nic.in',
 'https://lmc.up.nic.in/helpline.aspx',
 'Published on the corporation''s official helpline page on the lmc.up.nic.in government domain',
 true,
 'https://jansunwai.up.nic.in/',
 'On nic.in, a real government mail domain with live MX -- the most reliable of the UP entries. Lucknow also runs a citizen complaint system via everythingcivic.',
 26.8467, 80.9462, 25),

-- Delhi MCD. Left UNVERIFIED on purpose. The address is real and MCD does
-- publish it under "If Any Complaint : Mail to :", but the mailbox is literally
-- an IT helpdesk sitting in a Contact Us row headed "IT Department". A pothole
-- mailed there is likely to be triaged as a portal issue and closed. MCD's
-- actual civic channel is MCD311. Flip verified to true only if you decide an
-- IT helpdesk is an acceptable destination for field complaints.
('delhi-mcd',
 'Municipal Corporation of Delhi (MCD)',
 'mcd-ithelpdesk@mcd.nic.in',
 'https://mcdonline.nic.in/portal/feedback',
 'mcd-ithelpdesk[at]mcd[dot]nic[dot]in -- published under both "Any Feedback or Suggestion : Mail to :" and "If Any Complaint : Mail to :", alongside Citizen''s Call Center 155305 and the MCD311 app',
 false,
 'https://mcd.everythingcivic.com/',
 'UNVERIFIED BY CHOICE, not because the address is doubtful -- it appears on three separate official mcdonline.nic.in pages. The problem is fitness: it is an IT helpdesk mailbox. MCD routes garbage, streetlight, water, drainage and pothole complaints through MCD311 (app, or the online form linked as "Click here for Complaint" on every page) and the Citizen''s Call Center on 155305. MCD''s own footer mailto: link is broken -- it contains the [at]/[dot] obfuscated text verbatim -- which suggests the address is not actively maintained.',
 28.6139, 77.2090, 20),

-- UP statewide fallback. Left UNVERIFIED on purpose: this is the Directorate
-- of Local Bodies, a state-level office. Auto-mailing it every report that
-- misses a city entry would amount to routing individual potholes to a state
-- directorate. Kept as a documented last resort for a human to invoke.
('up-statewide',
 'Directorate of Local Bodies, Uttar Pradesh (Urban Development)',
 'diruplb@nic.in',
 'https://urbandevelopment.up.nic.in/contact.html',
 'Published on the UP Urban Development department''s official contact page on the up.nic.in government domain',
 false,
 'https://jansunwai.up.nic.in/',
 'UNVERIFIED BY CHOICE. A state directorate, not a body that fixes potholes. Enabling this with a wide radius would send every unmatched UP report to a state office, which is closer to spam than escalation. The right statewide channel for a citizen is the Jansunwai/IGRS portal, which issues a tracked reference and routes to the correct local body; CM Helpline is 1076.',
 26.8467, 80.9462, 400)

on conflict (jurisdiction) do update set
  name                 = excluded.name,
  contact_email        = excluded.contact_email,
  source_url           = excluded.source_url,
  quoted_context       = excluded.quoted_context,
  verified             = excluded.verified,
  grievance_portal_url = excluded.grievance_portal_url,
  notes                = excluded.notes,
  lat                  = excluded.lat,
  lng                  = excluded.lng,
  radius_km            = excluded.radius_km;
