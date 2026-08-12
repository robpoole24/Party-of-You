# PARTY OF YOU — RAILWAY ENVIRONMENT VARIABLES
# Add every variable below to your Railway project under:
# Project → Settings → Variables
#
# Copy the variable NAME exactly as written.
# Fill in the VALUE from each service's dashboard.
# ─────────────────────────────────────────────────────────────────


# ═══════════════════════════════════════════════════════
# CORE APPLICATION
# ═══════════════════════════════════════════════════════
NODE_ENV=production
PORT=3000
APP_URL=https://your-railway-domain.up.railway.app
SESSION_SECRET=
JWT_SECRET=
JWT_EXPIRY=7d


# ═══════════════════════════════════════════════════════
# DATABASE (Railway auto-injects these when you add plugins)
# ═══════════════════════════════════════════════════════
DATABASE_URL=          # Auto-set by Railway PostgreSQL plugin
REDIS_URL=             # Auto-set by Railway Redis plugin


# ═══════════════════════════════════════════════════════
# FREE APIS — GET KEYS TODAY
# ═══════════════════════════════════════════════════════

# Google Civic Information API
# console.cloud.google.com → APIs & Services → Credentials
GOOGLE_CIVIC_API_KEY=

# Google Maps JavaScript API (same Cloud project, separate key)
# console.cloud.google.com → APIs & Services → Credentials
GOOGLE_MAPS_API_KEY=

# Google Cloud Project ID (for Vertex AI / Veo)
# console.cloud.google.com → Project selector
GOOGLE_CLOUD_PROJECT_ID=

# US Census Bureau
# api.census.gov/data/key_signup.html
CENSUS_API_KEY=

# FEC.gov (Federal Election Commission)
# api.open.fec.gov/developers/
FEC_API_KEY=

# OpenStates / Plural Policy
# open.pluralpolicy.com/accounts/signup/
OPENSTATES_API_KEY=

# VoteHub Polling (currently open beta — add key when available)
# votehub.com/polls/api/
VOTEHUB_API_KEY=

# LegiScan (replaces ProPublica Congress API)
# legiscan.com/legiscan → Register → Get API Key
LEGISCAN_API_KEY=

# VoteSmart (candidate biographies, issue positions)
# votesmart.org/share/api → Request Access
VOTESMART_API_KEY=


# ═══════════════════════════════════════════════════════
# BULK DATA SOURCES (no API key — file-based ingestion)
# ═══════════════════════════════════════════════════════
# These have no key — data is downloaded manually and ingested.
# Set these flags to 'true' once each dataset is loaded into the DB.
DATASET_MIT_ELECTION_LAB_LOADED=false      # github.com/MEDSL
DATASET_PEW_RESEARCH_LOADED=false          # pewresearch.org/datasets/
DATASET_OPENSECRETS_LOADED=false           # opensecrets.org/open-data (awaiting approval)
DATASET_GSS_LOADED=false                   # gss.norc.org/get-the-data
DATASET_ANES_LOADED=false                  # electionstudies.org/data-center/
DATASET_GOVTRACK_LOADED=false              # govtrack.us/data (GitHub bulk files)
DATASET_PROPUBLICA_EXPENDITURES_LOADED=false  # House Office Expenditures archive


# ═══════════════════════════════════════════════════════
# PAID / PENDING APIS (leave blank until access granted)
# ═══════════════════════════════════════════════════════

# Ballotpedia Geographic + Bulk Data API
# Contact: data@ballotpedia.org
BALLOTPEDIA_API_KEY=

# Democracy Works Elections API
# data.democracy.works/request-pricing
DEMOCRACY_WORKS_API_KEY=

# BallotReady Hyperlocal Races API
# ballotready.org/our-data/
BALLOTREADY_API_KEY=


# ═══════════════════════════════════════════════════════
# VIDEO GENERATION APIS — MODULE 9 (AD CREATOR)
# ═══════════════════════════════════════════════════════

# ── Runway Gen-4.5 ──────────────────────────────────────
# Signup: dev.runwayml.com
# → Create account → Create Organization → Settings → API Keys
# No waitlist. Add $10 minimum credits to activate.
# Cost: ~$0.15/sec via API (Gen-4.5). ~$6 per 10s clip.
# Best for: Cinematic, documentary-style, b-roll footage
RUNWAY_API_KEY=
RUNWAY_API_SECRET=

# ── Google Veo 3.1 (Vertex AI) ───────────────────────────
# Uses your existing Google Cloud project (GOOGLE_CLOUD_PROJECT_ID above)
# Enable Vertex AI API: console.cloud.google.com → APIs → Vertex AI API
# Cost: $0.75/sec standard (~$6 per 8s clip) OR
#       $0.10/sec for Veo 3.1 Fast (720p, ~$0.80 per 8s clip)
# Best for: Highest quality cinematic output, native audio sync
# No separate key needed — uses Application Default Credentials
# Run: gcloud auth application-default login  OR use service account JSON
GOOGLE_APPLICATION_CREDENTIALS=   # Path to service account JSON (or use Railway's env)
VEO_LOCATION=us-central1           # GCP region for Veo API calls

# ── Kling AI ─────────────────────────────────────────────
# Signup: kling.ai/dev → Developer Portal → Resource Packages
# Start with $9.80 Trial Package (100 units, 30 days)
# Cost: ~$0.08-$0.10/sec (Kling 3.0 Standard)
# ~$0.50 per 5s clip, ~$1.00 per 10s clip at standard quality
# Best for: Character consistency, subject tracking across shots
KLING_API_KEY=
KLING_API_SECRET=

# ── HeyGen (Talking Head / Spokesperson Ads) ─────────────
# Signup: heygen.com → Settings → API → Generate Key
# Start: Pay-as-you-go from $5, no commitment
# Cost: ~$0.05/sec ($3/min) for Avatar V quality
# ~$1.50 per 30s spokesperson clip
# Best for: Candidate spokesperson videos, direct-to-camera ads
HEYGEN_API_KEY=

# ── ElevenLabs (Voiceover / Audio for ads without avatar) ─
# Signup: elevenlabs.io → Profile → API Key
# Free: 10k characters/month
# Starter: $5/month for 30k characters
# Best for: Narrated ads, voiceover on b-roll footage
ELEVENLABS_API_KEY=


# ═══════════════════════════════════════════════════════
# COMMUNICATIONS
# ═══════════════════════════════════════════════════════

# SendGrid (transactional + marketing email)
# Signup: signup.sendgrid.com
# → Settings → API Keys → Create API Key (Full Access)
# Free: 100 emails/day. Essentials: $19.95/mo for 50k
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=noreply@partyofyou.org
SENDGRID_FROM_NAME=Party of You

# Twilio (SMS — volunteer coordination, phone banking)
# Signup: twilio.com/try-twilio
# → Account → API Keys & Tokens
# Cost: ~$0.0079/SMS outbound
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=


# ═══════════════════════════════════════════════════════
# FILE STORAGE
# ═══════════════════════════════════════════════════════

# Cloudflare R2 (candidate photos, generated videos, petition PDFs)
# Signup: dash.cloudflare.com → R2 → Create Bucket
# → Manage R2 API Tokens → Create Token
# Free: 10GB storage, 1M ops/month. No egress fees.
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET=party-of-you-assets
CLOUDFLARE_R2_PUBLIC_URL=https://your-bucket.r2.dev


# ═══════════════════════════════════════════════════════
# AI (CLAUDE — for script generation, platform intelligence)
# ═══════════════════════════════════════════════════════

# Anthropic Claude API (ad script generation, platform intelligence)
# Signup: console.anthropic.com → API Keys
ANTHROPIC_API_KEY=


# ═══════════════════════════════════════════════════════
# FEATURE FLAGS
# Toggle modules on/off as each is built and tested.
# 'true' = module active | 'false' = disabled (shows "coming soon")
# ═══════════════════════════════════════════════════════
FEATURE_OPEN_SEAT_TRACKER=true       # Module 2 — live with FEC + OpenStates
FEATURE_POLLING_INTELLIGENCE=true    # Module 5 — live with VoteHub
FEATURE_DEMOGRAPHICS=true            # Module 5 — live with Census API
FEATURE_BALLOT_ACCESS_GUIDE=false    # Module 3 — needs research sprint
FEATURE_CANDIDATE_DASHBOARD=false    # Module 4 — in development
FEATURE_VOLUNTEER_PORTAL=false       # Module 6
FEATURE_EVENT_MANAGEMENT=false       # Module 7
FEATURE_VOTER_CONTACT_TOOLS=false    # Module 8
FEATURE_VIDEO_AD_CREATOR=false       # Module 9 — connect APIs first
FEATURE_COMMUNICATIONS_SUITE=false   # Module 9
FEATURE_FEC_REPORTING=false          # Module 10 — last


# ═══════════════════════════════════════════════════════
# VIDEO MODULE SPECIFIC FLAGS
# Enable each video provider independently as keys are added
# ═══════════════════════════════════════════════════════
VIDEO_PROVIDER_RUNWAY_ENABLED=false
VIDEO_PROVIDER_VEO_ENABLED=false
VIDEO_PROVIDER_KLING_ENABLED=false
VIDEO_PROVIDER_HEYGEN_ENABLED=false
VIDEO_MAX_DURATION_SECONDS=60        # Max ad length candidates can generate
VIDEO_DEFAULT_ASPECT_RATIO=16:9      # Default: horizontal (YouTube/Meta)
