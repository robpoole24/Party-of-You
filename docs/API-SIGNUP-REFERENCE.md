# API Signup Reference
## Platform Data Sources — Complete List with Signup URLs, Cost, and Priority

---

## FREE APIs — Sign Up Immediately

---

### 1. Google Civic Information API
**What it powers:** Address → district resolution (the geographic spine of everything), election info, polling locations, candidate data during active elections.
**Signup:** https://console.cloud.google.com/apis/library/civicinfo.googleapis.com
**Steps:**
1. Create a Google Cloud account (free)
2. Create a new project (e.g., "PartyOfYou")
3. Enable "Google Civic Information API"
4. Go to Credentials → Create API Key
5. Restrict the key to the Civic Information API
**Rate limits:** 25,000 requests/day free. Higher with billing enabled (pay-per-use, very cheap).
**Cost:** Free up to 25k/day. Beyond that: $0.005 per request.
**Notes:** Also grab the Maps JavaScript API key from the same console — needed for map display.

---

### 2. Census Bureau API
**What it powers:** District demographics (age, race, income, education, housing), population data by census tract, congressional district, county.
**Signup:** https://api.census.gov/data/key_signup.html
**Steps:**
1. Fill out the short form with name, email, org
2. Key arrives by email, usually within minutes
3. Click activation link in email
**Rate limits:** 500 queries/day without key (IP-based). No hard cap with key.
**Cost:** Completely free. US government data.
**Key data sets we'll use:**
- American Community Survey (ACS) 5-Year: `api.census.gov/data/{year}/acs/acs5`
- Decennial Census: `api.census.gov/data/2020/dec/pl`
- Population Estimates: `api.census.gov/data/{year}/pep/population`

---

### 3. VoteHub Polling API
**What it powers:** Real-time polling data from Quinnipiac, YouGov, Ipsos, Gallup, Siena, Emerson, Marist, Suffolk, Morning Consult, Fox News, and 100+ more sources.
**Signup:** https://votehub.com/polls/api/
**Steps:**
1. Review the documentation on that page
2. The API is currently open (no key required in beta) — test immediately at `https://votehub.com/polls/api/polls`
3. Monitor their site for key requirement as they move out of beta
**Rate limits:** Not published (beta). Monitor and cache aggressively.
**Cost:** Free. Licensed CC Attribution 4.0.
**Notes:** This is the single most valuable free polling resource. Prioritize integration.

---

### 4. OpenStates / Plural Policy API (State Legislature Data)
**What it powers:** State legislators by district, bills, votes, committee memberships — all 50 states.
**Signup:** https://open.pluralpolicy.com/accounts/signup/
**Steps:**
1. Create free account at the link above
2. Go to Account → API Keys → Create Key
3. Also grab bulk data downloads from: https://open.pluralpolicy.com/data/
**Rate limits:** 1,000 requests/day free tier.
**Cost:** Free for civic use. Paid plans for commercial/high-volume use.
**Notes:** OpenStates was acquired by Plural Policy in 2021. The API endpoint is still `v3.openstates.org`. Also supports GraphQL.

---

### 5. FEC.gov API (Federal Election Commission)
**What it powers:** All federal candidate filings, money raised, who's already running in federal races, PAC data, expenditure reports.
**Signup:** https://api.open.fec.gov/developers/
**Steps:**
1. Go to the URL above
2. Click "Get an API Key" (uses api.data.gov signup)
3. Confirm via email
**Rate limits:** 1,000 requests/hour with key. 20/hour without.
**Cost:** Completely free. Federal government data.
**Key endpoints:**
- Candidates: `/v1/candidates/`
- Filings: `/v1/filings/`
- Financial summaries: `/v1/candidate/{id}/totals/`
- Committees: `/v1/committees/`

---

### 6. ProPublica Congress API
**What it powers:** Congressional member data, voting records, bill sponsorship, committee memberships for House and Senate.
**Signup:** https://www.propublica.org/datastore/api/propublica-congress-api
**Steps:**
1. Click "Request an API Key" button on the page
2. Fill in name, email, intended use
3. Key arrives by email (usually same day)
**Rate limits:** Not published — reasonable use.
**Cost:** Free.
**Notes:** Excellent for incumbent voting record data to show how current officeholders have voted on key issues.

---

### 7. Pew Research Center Datasets
**What it powers:** Issue polling on politics, policy, social trends — long-running trend data ideal for showing where a district stands on issues over time.
**Signup:** https://www.pewresearch.org/datasets/
**Steps:**
1. Click "Log in or create a free account"
2. Create account with email
3. Browse datasets and download (SPSS or CSV format)
**Rate limits:** N/A — bulk file downloads, not an API.
**Cost:** Free with account. No API — we ingest bulk files on a schedule.
**Notes:** Updated quarterly. Build an ingestion job to check for new datasets monthly. Store in our DB with source attribution.

---

### 8. MIT Election Data + Science Lab (MEDSL)
**What it powers:** Historical election results — presidential, Senate, House, state, and local — at precinct level from 2016, constituency level back to 1976. The foundation of district partisan lean calculations.
**Signup:** https://dataverse.harvard.edu/dataverse/medsl (Harvard Dataverse — free account)
**Also available at:** https://github.com/MEDSL
**Steps:**
1. Create free Harvard Dataverse account to download
2. Most data also available directly from GitHub without account
3. Download all relevant datasets as tab-separated files
**Rate limits:** N/A — static file downloads.
**Cost:** Free.
**Notes:** This is a one-time bulk ingest + annual update. Critical for partisan lean index calculations. Download everything: House, Senate, President, state, local.

---

### 9. US Vote Foundation Civic Data API
**What it powers:** Election official directory — who runs each county's elections, their office address, phone, and jurisdiction info. Critical for "where to file" guidance.
**Signup:** https://civicdata.usvotefoundation.org/
**Steps:**
1. Browse the documentation at the link
2. Contact them through the site to request API access for civic use
3. Likely free or low-cost given the civic mission alignment
**Cost:** Contact for pricing — civic/nonprofit rates available.

---

### 10. General Social Survey (GSS) — NORC at University of Chicago
**What it powers:** Long-running public opinion data since 1972 on social issues, economic attitudes, political views — invaluable for district-level issue context.
**Signup:** https://gss.norc.org/get-the-data
**Steps:**
1. Visit the link
2. Download available in SPSS, Stata, R, CSV formats — no account required
**Cost:** Free.
**Notes:** Ingest as bulk file. Updated every 2 years. Important for issue trend analysis.

---

### 11. American National Election Studies (ANES)
**What it powers:** The gold standard of voter behavior research since 1948 — political participation, voting behavior, partisan identity.
**Signup:** https://electionstudies.org/data-center/
**Steps:**
1. Free account registration on the data center
2. Download any dataset
**Cost:** Free.

---

### 12. KFF (Kaiser Family Foundation) Health Polling
**What it powers:** Healthcare issue polling by state — crucial since healthcare is a top issue in most districts.
**Signup:** https://www.kff.org/statedata/
**Steps:**
1. No signup required for most data
2. Some interactive data available as downloadable CSV
**Cost:** Free.

---

### 13. OpenSecrets / CRP API
**What it powers:** Fundraising and spending data, donor lists, industries contributing to incumbents — powerful for showing who funds the opponent.
**Signup:** https://www.opensecrets.org/api/admin/index.php?function=signup
**Steps:**
1. Create account at the link
2. Free API key for non-commercial use
**Rate limits:** 200 queries/hour free.
**Cost:** Free for non-commercial. Fits our mission exactly.
**Notes:** Excellent for showing candidates (and voters) that incumbents take corporate money.

---

### 14. BallotReady API
**What it powers:** Down-ballot races — school board, city council, water districts, special districts — the most local level. Extremely valuable for recruiting local candidates.
**Signup:** https://www.ballotready.org/our-data/
**Steps:**
1. Contact via their data page — they work with civic partners
2. Pitch the civic mission; they've worked with nonprofits at reduced rates
**Cost:** Contact for pricing. Civic partnership rates likely available.
**Notes:** Best source for hyperlocal race data. Priority negotiation target.

---

## PAID APIs — Budget Planning

---

### 15. Ballotpedia API (HIGHEST PRIORITY PAID SOURCE)
**What it powers:** Candidate lists and metadata for all federal, state, and local elections including special elections. District-level election calendars. Geographic API for address → ballot lookup.
**Contact:** data@ballotpedia.org
**Documentation:** https://developer.ballotpedia.org/
**Pricing:**
- Ballotpedia does NOT publish pricing publicly — it's negotiated based on use case and volume
- Estimated range based on industry knowledge: $5,000–$25,000/year depending on API package and volume
- Geographic API (address lookup) and Bulk Data (candidate/race feeds) are separate packages
- Civic/nonprofit rates may apply — pitch the mission hard
- **What to ask for:** Geographic API + Candidate Bulk Data + Election Calendar feed
- **What to say:** Non-commercial civic platform, grassroots candidates, no corporate funding
**Contact strategy:** Email data@ballotpedia.org with a clear mission brief. They're based in Middleton, WI — same state as you. Lead with that.

---

### 16. Democracy Works Elections API
**What it powers:** The most authoritative source for election dates, deadlines, voter registration info, and ID requirements — verified directly from election officials. Covers jurisdictions over 5,000 people.
**Contact:** https://data.democracy.works/request-pricing
**Documentation:** https://developers.democracy.works/api/v2
**Pricing:**
- Not public — contact for quote
- They work with nonprofits and civic organizations; mission-aligned rates likely
- Partners include Google, Nextdoor, Snapchat — expect enterprise-tier pricing but they have tiered access
- Free 2025 Elections Calendar available at: https://data.democracy.works/ (start here to evaluate the data quality)
**Contact strategy:** Request pricing at the link above. Nonprofit/civic rate is the angle.

---

### 17. Twillio (SMS / Phone Banking Communications)
**What it powers:** Text message broadcasts to volunteer lists, candidate notification system, two-way SMS for voter contact programs.
**Signup:** https://www.twilio.com/try-twilio
**Pricing:**
- SMS (US): ~$0.0079/message sent, ~$0.0075/message received
- Phone numbers: ~$1.15/month per number
- For a candidate sending 10,000 texts: ~$79
- **Realistic monthly budget for active platform:** $50–$200/month depending on usage
**Notes:** Political messaging requires compliance with TCPA. Twilio has political messaging guidelines. We handle opt-in collection in the volunteer signup flow.

---

### 18. SendGrid (Email Marketing)
**What it powers:** Candidate email marketing to supporter lists, platform notification emails, volunteer coordination.
**Signup:** https://signup.sendgrid.com/
**Pricing:**
- Free: 100 emails/day forever
- Essentials: $19.95/month for 50,000 emails
- Pro: $89.95/month for 100,000 emails
**Notes:** Start on the free tier during development. Move to Essentials when candidates are active.

---

### 19. Cloudflare R2 (File Storage)
**What it powers:** Candidate photo uploads, generated PDF petition sheets, mailer templates, voter file uploads (temporary processing), FEC report exports.
**Signup:** https://dash.cloudflare.com/sign-up
**Pricing:**
- Free: 10 GB storage, 1M Class A operations, 10M Class B operations/month
- Beyond free: $0.015/GB storage, $4.50/million Class A ops
- **Realistic monthly cost at scale:** $5–$30/month
**Notes:** No egress fees — major advantage over S3 for a platform serving file downloads.

---

### 20. Railway (Hosting — You're Already Using This)
**What it powers:** All backend services, PostgreSQL database, Redis/Bull job queues.
**Current plan:** Check your dashboard.
**Pricing reference:** https://railway.app/pricing
**Notes:** As the platform grows, estimate $20–$50/month for the full stack. Database storage and compute are the main cost drivers.

---

## COST SUMMARY TABLE

| Source | Monthly Est. | Annual Est. | Priority |
|---|---|---|---|
| Google Civic API | Free–$10 | Free–$120 | Critical |
| Census Bureau API | Free | Free | Critical |
| VoteHub Polling API | Free | Free | Critical |
| OpenStates API | Free | Free | Critical |
| FEC.gov API | Free | Free | Critical |
| ProPublica Congress API | Free | Free | High |
| Pew Research Datasets | Free | Free | High |
| MIT Election Lab | Free | Free | High |
| OpenSecrets API | Free | Free | High |
| GSS/ANES/KFF | Free | Free | Medium |
| US Vote Foundation | TBD | TBD | Medium |
| BallotReady | TBD | TBD | High |
| **Ballotpedia API** | **~$400–$2,000** | **~$5k–$25k** | **Critical** |
| **Democracy Works API** | **TBD** | **TBD** | **High** |
| Twilio SMS | $50–$200 | $600–$2,400 | Medium |
| SendGrid Email | Free–$20 | Free–$240 | Medium |
| Cloudflare R2 | Free–$30 | Free–$360 | Low |
| Railway Hosting | $20–$50 | $240–$600 | Critical |

**Minimum viable operating cost (free APIs only + hosting):** ~$20–$50/month
**Full stack with Ballotpedia (low estimate):** ~$500–$600/month
**Full stack with Ballotpedia (high estimate):** ~$2,300/month

---

## OUTREACH EMAIL TEMPLATE — Ballotpedia

> Subject: Civic Platform API Partnership Inquiry
>
> My name is Rob Poole and I'm building an open-source civic infrastructure platform designed to help grassroots, small-dollar candidates run for office at every level of government — from school board to Congress. The platform is permanently free, ad-free, and accepts no corporate funding.
>
> Based in Wisconsin (Greendale), I'm reaching out because Ballotpedia is also Wisconsin-based, and your election data is the most comprehensive available for what we need: open seat tracking, candidate filing information, and election calendars down to the local level.
>
> We're looking to discuss API access — specifically the Geographic API and Candidate/Election bulk data — and whether civic-mission pricing might be available. Our platform serves candidates who, like Ballotpedia itself, exist outside the major-party establishment infrastructure.
>
> I'd welcome a conversation at your convenience.
> Rob Poole | robpoole24@gmail.com | 920-666-9979

---

## DATA INGESTION PRIORITY ORDER

**Week 1 (Start building immediately — keys in hand today):**
- Google Civic API → geographic spine
- Census Bureau API → demographics
- FEC.gov API → federal race data
- OpenStates API → state legislature data
- VoteHub API → polling feed

**Week 2–3 (After free keys, start bulk ingests):**
- MIT Election Lab → historical partisan lean (one-time bulk)
- Pew Research datasets → issue polling history
- ProPublica Congress API → incumbent voting records
- OpenSecrets API → incumbent donor profiles

**Month 2 (After negotiating paid access):**
- Ballotpedia API → comprehensive race/candidate data
- Democracy Works API → authoritative election dates/deadlines

**Month 3+ (As platform grows):**
- BallotReady API → hyperlocal race data
- Twilio → SMS integration
- State-specific scrapers → Secretary of State election results feeds
