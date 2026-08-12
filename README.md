# The Platform — Grassroots Candidate Infrastructure

A free, ad-free, transparent political infrastructure platform for independent and grassroots candidates. No corporate money. No PAC money. Just tools.

---

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys (see API-SIGNUP-REFERENCE.md)

# 3. Check which APIs are connected
npm run api-status

# 4. Start development
npm run dev
```

---

## API Setup — Do This First

See `docs/API-SIGNUP-REFERENCE.md` for the complete guide.

### Sign up for these free APIs immediately:

| API | URL | Est. Time |
|-----|-----|-----------|
| Google Civic | https://console.cloud.google.com | 10 min |
| Census Bureau | https://api.census.gov/data/key_signup.html | 5 min |
| FEC.gov | https://api.open.fec.gov/developers/ | 5 min |
| ProPublica | https://www.propublica.org/datastore/api/propublica-congress-api | 5 min |
| OpenStates | https://open.pluralpolicy.com/accounts/signup/ | 5 min |
| OpenSecrets | https://www.opensecrets.org/api/admin/index.php?function=signup | 5 min |

VoteHub is currently open beta — no key required. Test at: `https://votehub.com/polls/api/polls`

### Contact for paid API quotes:

- **Ballotpedia:** data@ballotpedia.org — mention Wisconsin connection, civic mission, no corporate funding
- **Democracy Works:** https://data.democracy.works/request-pricing
- **BallotReady:** https://www.ballotready.org/our-data/

---

## Architecture

```
src/
├── config/
│   └── apis.js              ← Central API registry — all keys, endpoints, status
├── data-layer/
│   ├── geographic.js        ← Address → district resolution (the spine)
│   ├── open-seats.js        ← Race finder — what can someone run for?
│   ├── polling.js           ← Poll aggregator (VoteHub + Pew + historical)
│   └── demographics.js      ← Census demographics by district
├── modules/                 ← Feature modules (built in order)
│   ├── 01-recruitment/      ← Candidate onboarding funnel
│   ├── 02-seat-tracker/     ← Open seat display + race pages
│   ├── 03-ballot-access/    ← Signature sheets, filing guides
│   ├── 04-dashboard/        ← Candidate control center
│   ├── 05-intelligence/     ← Polling + demographics display
│   ├── 06-volunteers/       ← Volunteer recruitment + management
│   ├── 07-events/           ← Event management + scheduling
│   ├── 08-voter-contact/    ← Phone bank + canvassing lists
│   ├── 09-communications/   ← Marketing + social + email suite
│   └── 10-fec/              ← FEC reporting + donation processing
└── server.js                ← Express app entry point
```

---

## Module Build Order

| # | Module | Depends On | Status |
|---|--------|-----------|--------|
| 1 | Candidate Recruitment | Geographic, Open Seats | 🔲 Next |
| 2 | Open Seat Tracker | Geographic, FEC, OpenStates | 🔲 |
| 3 | Ballot Access Guide | Research (manual) | 🔲 |
| 4 | Candidate Dashboard | All data layer | 🔲 |
| 5 | District Intelligence | Polling, Demographics | 🔲 |
| 6 | Volunteer Portal | Dashboard | 🔲 |
| 7 | Event Management | Dashboard | 🔲 |
| 8 | Voter Contact Tools | Volunteer Portal | 🔲 |
| 9 | Communications Suite | Dashboard | 🔲 |
| 10 | FEC Reporting | Dashboard, Payments | 🔲 Last |

---

## Data Sources

### Free (Connect Now)
- **Google Civic API** — Geographic spine, election data
- **Census Bureau API** — District demographics
- **VoteHub** — Real-time polling aggregator (CC4.0)
- **FEC.gov API** — Federal races, candidate filings, fundraising
- **ProPublica Congress API** — Incumbent voting records
- **OpenStates API** — State legislature data
- **OpenSecrets API** — Incumbent donor profiles
- **MIT Election Lab** — Historical partisan lean (bulk ingest)
- **Pew Research** — Issue polling datasets (bulk ingest)

### Paid (Negotiate Access)
- **Ballotpedia** — Comprehensive race/candidate data (~$5-25k/yr)
- **Democracy Works** — Authoritative election dates/deadlines (contact for pricing)
- **BallotReady** — Hyperlocal races (contact for pricing)

---

## Tech Stack

- **Backend:** Node.js / Express
- **Database:** PostgreSQL (Railway)
- **Cache:** Redis via Bull queue
- **Storage:** Cloudflare R2
- **Frontend:** React (separate repo)
- **Deploy:** Railway (auto-deploy from GitHub main)
- **Email:** SendGrid
- **SMS:** Twilio

---

## Core Principles (Non-Negotiable)

1. Permanently free for all users
2. No advertising, ever
3. No user data sold or shared
4. No accounts required for public-facing tools
5. No corporate money accepted by candidates using the platform
6. No PAC money
7. Full financial transparency — every dollar tracked publicly
8. Candidates own their data — full export on request or termination

---

## Legal Notes

- Platform is infrastructure, not a political party
- Candidates are legally responsible for their own FEC/state compliance
- See `docs/TERMS-OF-SERVICE.md` for full legal framework
- FEC reporting module (Module 10) built last — consult election law attorney before launch
