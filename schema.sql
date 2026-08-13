-- PARTY OF YOU — COMPLETE DATABASE SCHEMA
-- Run this against your Railway PostgreSQL instance to initialize.
-- Railway auto-provides DATABASE_URL — connect with:
--   psql $DATABASE_URL < schema.sql

-- ═══════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search on candidate names


-- ═══════════════════════════════════════════════════
-- USERS & AUTH
-- ═══════════════════════════════════════════════════

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'volunteer',  -- 'candidate' | 'volunteer' | 'admin'
  full_name         TEXT,
  phone             TEXT,
  address           TEXT,
  city              TEXT,
  state             CHAR(2),
  zip               TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_login        TIMESTAMPTZ,
  is_active         BOOLEAN DEFAULT TRUE,
  email_verified    BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_state ON users(state);


-- ═══════════════════════════════════════════════════
-- CANDIDATES
-- ═══════════════════════════════════════════════════

CREATE TABLE candidates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Personal info
  full_name         TEXT NOT NULL,
  preferred_name    TEXT,
  bio               TEXT,
  photo_url         TEXT,
  
  -- Contact
  campaign_email    TEXT,
  campaign_phone    TEXT,
  campaign_website  TEXT,  -- Their external domain if they have one
  subdomain         TEXT UNIQUE,  -- subdomain.partyofyou.org
  
  -- Race info
  race_id           TEXT,  -- References races.id
  office_sought     TEXT,
  district          TEXT,
  state             CHAR(2),
  
  -- Platform
  platform_planks   JSONB DEFAULT '[]',  -- Selected platform positions
  
  -- Financial
  fec_committee_id  TEXT,  -- Their FEC-registered committee ID
  
  -- Status
  status            TEXT DEFAULT 'onboarding',  -- 'onboarding' | 'active' | 'suspended' | 'closed'
  onboarding_step   INTEGER DEFAULT 1,
  platform_agreed   BOOLEAN DEFAULT FALSE,
  platform_agreed_at TIMESTAMPTZ,
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_candidates_user ON candidates(user_id);
CREATE INDEX idx_candidates_state ON candidates(state);
CREATE INDEX idx_candidates_status ON candidates(status);


-- ═══════════════════════════════════════════════════
-- RACES (Open Seat Tracker)
-- ═══════════════════════════════════════════════════

CREATE TABLE races (
  id                TEXT PRIMARY KEY,  -- e.g., "federal-WI-us-house-WI-5"
  type              TEXT NOT NULL,     -- 'US House' | 'US Senate' | 'State Senate' | etc.
  level             TEXT NOT NULL,     -- 'federal' | 'state' | 'local'
  state             CHAR(2) NOT NULL,
  district          TEXT,
  office            TEXT NOT NULL,
  
  -- Incumbent
  incumbent_name    TEXT,
  incumbent_party   TEXT,
  is_open_seat      BOOLEAN DEFAULT FALSE,
  incumbent_retiring BOOLEAN DEFAULT FALSE,
  
  -- Timeline
  primary_date      DATE,
  election_date     DATE,
  filing_deadline   DATE,
  filing_status     TEXT,  -- 'open' | 'closing-soon' | 'closed' | 'unknown'
  
  -- Ballot access
  signature_requirement INTEGER,
  filing_fee        DECIMAL(10,2),
  
  -- Data
  source            TEXT,
  last_updated      TIMESTAMPTZ DEFAULT NOW(),
  data_limited      BOOLEAN DEFAULT FALSE,
  data_note         TEXT
);

CREATE INDEX idx_races_state ON races(state);
CREATE INDEX idx_races_level ON races(level);
CREATE INDEX idx_races_filing_status ON races(filing_status);
CREATE INDEX idx_races_election_date ON races(election_date);


-- ═══════════════════════════════════════════════════
-- BALLOT ACCESS (Module 3)
-- ═══════════════════════════════════════════════════

CREATE TABLE ballot_access_requirements (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state             CHAR(2) NOT NULL,
  office_type       TEXT NOT NULL,  -- 'US House' | 'US Senate' | 'State Senate' | etc.
  party_status      TEXT NOT NULL,  -- 'independent' | 'third_party' | 'minor_party'
  
  -- Signatures
  signature_count   INTEGER,
  signature_pct     DECIMAL(5,4),  -- As percentage of votes cast
  signature_basis   TEXT,          -- What the percentage is of
  eligible_signers  TEXT,          -- Who can sign (registered voters, party members, etc.)
  
  -- Process
  petition_requirements TEXT,      -- Witness signatures, notarization, etc.
  filing_fee        DECIMAL(10,2),
  filing_office     TEXT,
  filing_office_url TEXT,
  
  -- Candidacy requirements
  residency_requirement TEXT,
  age_minimum       INTEGER,
  other_requirements TEXT,
  
  -- Sources
  source_statute    TEXT,  -- State statute citation
  source_url        TEXT,
  verified_date     DATE,
  verified_by       TEXT,
  
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(state, office_type, party_status)
);

CREATE INDEX idx_ballot_access_state ON ballot_access_requirements(state);


-- ═══════════════════════════════════════════════════
-- PETITION SIGNATURE TRACKER (Module 3)
-- ═══════════════════════════════════════════════════

CREATE TABLE petition_drives (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  race_id           TEXT,
  goal              INTEGER NOT NULL,      -- Required signatures
  buffer_goal       INTEGER,              -- Recommended (goal * 1.25 for safety)
  deadline          DATE,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ
);

CREATE TABLE petition_log_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  drive_id          UUID REFERENCES petition_drives(id) ON DELETE CASCADE,
  logged_at         TIMESTAMPTZ DEFAULT NOW(),
  count_added       INTEGER NOT NULL,
  cumulative_total  INTEGER NOT NULL,
  location          TEXT,  -- Where signatures were gathered
  notes             TEXT,
  logged_by         UUID REFERENCES users(id)
);

CREATE INDEX idx_petition_drive ON petition_log_entries(drive_id);


-- ═══════════════════════════════════════════════════
-- EVENTS (Module 7)
-- ═══════════════════════════════════════════════════

CREATE TABLE events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  
  title             TEXT NOT NULL,
  event_type        TEXT NOT NULL,  -- 'town_hall' | 'fundraiser' | 'canvass' | 'phone_bank' | 'meet_greet' | 'other'
  description       TEXT,
  
  -- When
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ,
  timezone          TEXT DEFAULT 'America/Chicago',
  
  -- Where
  location_name     TEXT,
  address           TEXT,
  city              TEXT,
  state             CHAR(2),
  zip               TEXT,
  latitude          DECIMAL(10,7),
  longitude         DECIMAL(10,7),
  virtual_link      TEXT,  -- Zoom/Meet link for virtual events
  is_virtual        BOOLEAN DEFAULT FALSE,
  
  -- Visibility
  is_public         BOOLEAN DEFAULT TRUE,  -- Shows on candidate website
  
  -- RSVP
  max_attendees     INTEGER,
  rsvp_count        INTEGER DEFAULT 0,
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE event_rsvps (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id          UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),  -- NULL for anonymous RSVPs
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  notes             TEXT,
  status            TEXT DEFAULT 'confirmed',  -- 'confirmed' | 'cancelled' | 'waitlisted'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_candidate ON events(candidate_id);
CREATE INDEX idx_events_date ON events(start_time);
CREATE INDEX idx_events_public ON events(is_public, start_time);


-- ═══════════════════════════════════════════════════
-- VOLUNTEERS (Module 6)
-- ═══════════════════════════════════════════════════

CREATE TABLE volunteers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id),
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  zip               TEXT,
  
  -- Skills and availability
  skills            TEXT[],  -- 'canvassing' | 'phone_banking' | 'lit_drop' | 'data_entry' | 'social_media' | 'legal' | 'finance' | 'events'
  availability      JSONB,   -- { weekdays: bool, weekends: bool, evenings: bool }
  
  -- Status
  status            TEXT DEFAULT 'active',  -- 'active' | 'inactive' | 'do_not_contact'
  hours_logged      DECIMAL(6,1) DEFAULT 0,
  
  signed_up_at      TIMESTAMPTZ DEFAULT NOW(),
  last_contact      TIMESTAMPTZ
);

CREATE INDEX idx_volunteers_candidate ON volunteers(candidate_id);
CREATE INDEX idx_volunteers_zip ON volunteers(zip);


-- ═══════════════════════════════════════════════════
-- VOTER CONTACT (Module 8)
-- ═══════════════════════════════════════════════════

-- Uploaded voter file records (candidate accesses, we provide tools)
-- Files are temporary — we don't permanently store voter PII
CREATE TABLE voter_contact_sessions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  session_type      TEXT NOT NULL,  -- 'phone_bank' | 'canvass' | 'lit_drop'
  date              DATE NOT NULL,
  volunteer_count   INTEGER DEFAULT 1,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Contact outcomes (no PII — just outcome codes by voter file ID)
CREATE TABLE contact_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id        UUID REFERENCES voter_contact_sessions(id),
  candidate_id      UUID REFERENCES candidates(id),
  voter_file_id     TEXT NOT NULL,  -- From the candidate's voter file — we don't store the name
  contact_method    TEXT,           -- 'phone' | 'door' | 'text'
  outcome           TEXT,           -- 'support' | 'lean_support' | 'undecided' | 'lean_oppose' | 'oppose' | 'moved' | 'deceased' | 'no_answer' | 'left_message' | 'dnc'
  contacted_at      TIMESTAMPTZ DEFAULT NOW(),
  volunteer_id      UUID REFERENCES volunteers(id),
  notes             TEXT
);

CREATE INDEX idx_contact_log_candidate ON contact_log(candidate_id);
CREATE INDEX idx_contact_log_session ON contact_log(session_id);


-- ═══════════════════════════════════════════════════
-- DONATIONS / FINANCE (Module 10 — built last)
-- Schema designed now so we can accept and track data early
-- ═══════════════════════════════════════════════════

CREATE TABLE donations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  
  -- Donor info (FEC required fields)
  donor_name        TEXT NOT NULL,
  donor_first_name  TEXT,
  donor_last_name   TEXT,
  donor_address     TEXT,
  donor_city        TEXT,
  donor_state       CHAR(2),
  donor_zip         TEXT,
  donor_employer    TEXT,   -- FEC required above $200
  donor_occupation  TEXT,   -- FEC required above $200
  
  -- Transaction
  amount            DECIMAL(10,2) NOT NULL,
  donated_at        TIMESTAMPTZ DEFAULT NOW(),
  payment_method    TEXT,   -- 'stripe' | 'check' | 'cash' | 'other'
  transaction_id    TEXT,   -- Payment processor transaction ID
  
  -- FEC flags
  is_earmarked      BOOLEAN DEFAULT FALSE,
  earmark_candidate TEXT,   -- If earmarked for a specific federal candidate
  refunded_at       TIMESTAMPTZ,
  refund_amount     DECIMAL(10,2),
  
  -- Compliance
  fec_reported      BOOLEAN DEFAULT FALSE,
  state_reported    BOOLEAN DEFAULT FALSE,
  
  notes             TEXT
);

CREATE INDEX idx_donations_candidate ON donations(candidate_id);
CREATE INDEX idx_donations_date ON donations(donated_at);
CREATE INDEX idx_donations_fec ON donations(fec_reported, candidate_id);


-- ═══════════════════════════════════════════════════
-- DATA INTELLIGENCE TABLES (Ingested from bulk sources)
-- ═══════════════════════════════════════════════════

CREATE TABLE historical_election_results (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state             CHAR(2) NOT NULL,
  district          TEXT,
  year              INTEGER NOT NULL,
  office            TEXT NOT NULL,
  candidate_name    TEXT NOT NULL,
  party             TEXT,
  votes             INTEGER,
  total_votes       INTEGER,
  win_indicator     BOOLEAN,
  source            TEXT DEFAULT 'MIT Election Lab',
  UNIQUE(state, district, year, office, candidate_name)
);

CREATE INDEX idx_election_results_state_district ON historical_election_results(state, district, year);
CREATE INDEX idx_election_results_office ON historical_election_results(office, year);


CREATE TABLE voting_records (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vote_id           TEXT UNIQUE,
  congress          INTEGER,
  session           INTEGER,
  chamber           TEXT,
  vote_type         TEXT,
  date              TIMESTAMPTZ,
  question          TEXT,
  result            TEXT,
  vote_counts       JSONB,
  govtrack_source   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_voting_records_congress ON voting_records(congress, chamber);
CREATE INDEX idx_voting_records_date ON voting_records(date);


CREATE TABLE legislators (
  bioguide_id       TEXT PRIMARY KEY,
  full_name         TEXT NOT NULL,
  party             TEXT,
  state             CHAR(2),
  district          TEXT,
  chamber           TEXT,
  start_date        DATE,
  end_date          DATE,
  govtrack_id       TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_legislators_state ON legislators(state, district);
CREATE INDEX idx_legislators_active ON legislators(end_date, state);


CREATE TABLE issue_polling_data (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pollster          TEXT,
  source            TEXT,
  state             CHAR(2),
  topic             TEXT,
  question_text     TEXT,
  answers           JSONB,
  sample_size       INTEGER,
  population        TEXT,
  survey_date       DATE,
  published_date    DATE,
  source_url        TEXT,
  attribution       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_polling_state_topic ON issue_polling_data(state, topic);
CREATE INDEX idx_polling_date ON issue_polling_data(survey_date DESC);


CREATE TABLE opensecrets_categories (
  cat_code          TEXT PRIMARY KEY,
  cat_name          TEXT,
  industry          TEXT,
  sector            TEXT,
  sector_long       TEXT
);

CREATE TABLE opensecrets_candidates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle             TEXT,
  fec_id            TEXT,
  crp_id            TEXT,
  name              TEXT,
  party             TEXT,
  state             CHAR(2),
  seat              TEXT,
  total_raised      DECIMAL(15,2),
  total_spent       DECIMAL(15,2),
  cash_on_hand      DECIMAL(15,2),
  debt              DECIMAL(15,2),
  UNIQUE(cycle, fec_id)
);

CREATE TABLE house_expenditures (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bioguide_id       TEXT,
  office_name       TEXT,
  year              INTEGER,
  quarter           INTEGER,
  category          TEXT,
  amount            DECIMAL(12,2)
);

CREATE INDEX idx_expenditures_member ON house_expenditures(bioguide_id, year);


-- ═══════════════════════════════════════════════════
-- VIDEO ADS (Module 9)
-- ═══════════════════════════════════════════════════

CREATE TABLE video_ad_jobs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  
  -- Brief
  brief             JSONB NOT NULL,  -- The full ad brief from the candidate
  
  -- Script
  script            JSONB,           -- Generated script from Claude API
  script_edited     JSONB,           -- Candidate's edited version
  
  -- Generation
  provider          TEXT,            -- 'runway' | 'veo' | 'kling' | 'heygen'
  provider_job_id   TEXT,            -- Provider's job/task ID for polling
  ad_style          TEXT,
  duration_seconds  INTEGER,
  aspect_ratio      TEXT DEFAULT '16:9',
  
  -- Output
  status            TEXT DEFAULT 'draft',  -- 'draft' | 'scripted' | 'rendering' | 'complete' | 'failed'
  video_url         TEXT,            -- Final video URL in R2 storage
  thumbnail_url     TEXT,
  estimated_cost    DECIMAL(8,2),
  actual_cost       DECIMAL(8,2),
  
  -- Fact check
  fact_check_status TEXT DEFAULT 'pending',  -- 'pending' | 'verified' | 'needs_review'
  fact_check_notes  TEXT,
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_video_jobs_candidate ON video_ad_jobs(candidate_id);
CREATE INDEX idx_video_jobs_status ON video_ad_jobs(status);


-- ═══════════════════════════════════════════════════
-- PLATFORM CONTENT
-- ═══════════════════════════════════════════════════

CREATE TABLE platform_planks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category          TEXT NOT NULL,   -- 'economy' | 'healthcare' | 'housing' | etc.
  title             TEXT NOT NULL,
  short_description TEXT,
  full_text         TEXT,
  talking_points    TEXT[],
  is_core           BOOLEAN DEFAULT FALSE,  -- Core = required, not optional
  sort_order        INTEGER DEFAULT 0,
  is_active         BOOLEAN DEFAULT TRUE
);

CREATE TABLE candidate_planks (
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  plank_id          UUID REFERENCES platform_planks(id),
  custom_text       TEXT,  -- Candidate's personalized version
  added_at          TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (candidate_id, plank_id)
);


-- ═══════════════════════════════════════════════════
-- AUDIT LOG
-- Track all significant platform actions for transparency
-- ═══════════════════════════════════════════════════

CREATE TABLE audit_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id),
  candidate_id      UUID REFERENCES candidates(id),
  action            TEXT NOT NULL,
  entity_type       TEXT,
  entity_id         TEXT,
  details           JSONB,
  ip_address        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_candidate ON audit_log(candidate_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);

-- ═══════════════════════════════════════════════════
-- AUTH & PLEDGE ADDITIONS
-- ═══════════════════════════════════════════════════

-- Permanent platform pledge record
CREATE TABLE IF NOT EXISTS candidate_pledges (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  pledges           JSONB NOT NULL,
  signature         TEXT NOT NULL,
  pledged_at        TIMESTAMPTZ NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  platform_version  TEXT DEFAULT '1.0',
  UNIQUE(candidate_id)
);

-- Platform announcements (shown on all candidate dashboards)
CREATE TABLE IF NOT EXISTS platform_announcements (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message    TEXT NOT NULL,
  type       TEXT DEFAULT 'info',
  expires_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
