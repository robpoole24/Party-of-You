/**
 * JUST HELP — VOLUNTEERING & DONATION ENHANCEMENT SPEC
 * 
 * This document defines:
 *   A. New data fields to add to Just Help's organization records
 *   B. New "Volunteer with Us" feature for Just Help's org detail modal
 *   C. The integration between Just Help + Party of You event builder
 *   D. The event signup flow with volunteer data collection
 *   E. Database changes needed in Just Help's repo
 * 
 * The core concept:
 *   Candidates use Just Help to find local organizations,
 *   then build campaign events around those organizations
 *   (volunteer days, donation drives, etc.) — all from the Party of You
 *   dashboard, with event signups feeding directly into their
 *   volunteer communication list.
 */


// ═══════════════════════════════════════════════════════════════
// A. JUST HELP DATABASE ADDITIONS
//    Add these columns to the `resources` table in Just Help's DB
// ═══════════════════════════════════════════════════════════════

const JUST_HELP_SCHEMA_ADDITIONS = `
  -- Volunteering info
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS volunteer_available BOOLEAN DEFAULT false;
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS volunteer_url TEXT;
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS volunteer_phone TEXT;
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS volunteer_email TEXT;
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS volunteer_notes TEXT;
  -- e.g. "Call to schedule. Groups of 10+ welcome. Must be 16+."

  -- Donation/in-kind giving info
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS donations_accepted BOOLEAN DEFAULT false;
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS donation_url TEXT;
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS donation_types TEXT[];
  -- e.g. ['non-perishable food', 'hygiene products', 'diapers', 'monetary']
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS donation_drop_address TEXT;
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS donation_hours TEXT;
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS donation_notes TEXT;
  -- e.g. "Drop-off Mon–Fri 9am–4pm. No expired food. Call ahead for large donations."

  -- Wishlist (specific current needs)
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS current_needs TEXT[];
  -- e.g. ['canned beans', 'peanut butter', 'diapers size 3-4', 'winter coats']
  ALTER TABLE resources ADD COLUMN IF NOT EXISTS needs_updated_at TIMESTAMPTZ;
`;


// ═══════════════════════════════════════════════════════════════
// B. JUST HELP ORG DETAIL MODAL — NEW SECTIONS
//    Add these two sections to the existing org detail modal/sidebar
//    in Just Help's map.html / map.js
// ═══════════════════════════════════════════════════════════════

/**
 * Renders the "Volunteer Here" section inside the org detail modal.
 * Only shown when volunteer_available = true.
 * 
 * @param {object} org - The organization record from the DB
 * @returns {string} HTML string
 */
function renderVolunteerSection(org) {
  if (!org.volunteer_available) return '';

  const links = [];
  if (org.volunteer_url) {
    links.push(`<a href="${org.volunteer_url}" target="_blank" rel="noopener" class="jh-detail-link">Sign up to volunteer →</a>`);
  }
  if (org.volunteer_phone) {
    links.push(`<a href="tel:${org.volunteer_phone}" class="jh-detail-link">Call to volunteer: ${org.volunteer_phone}</a>`);
  }
  if (org.volunteer_email) {
    links.push(`<a href="mailto:${org.volunteer_email}" class="jh-detail-link">Email to volunteer: ${org.volunteer_email}</a>`);
  }

  return `
    <div class="jh-modal-section jh-volunteer-section">
      <div class="jh-modal-section-label">
        <span class="jh-section-icon">🙋</span> Volunteer Here
      </div>
      ${org.volunteer_notes ? `<p class="jh-modal-note">${org.volunteer_notes}</p>` : ''}
      <div class="jh-detail-links">
        ${links.join('\n        ')}
      </div>
    </div>
  `;
}

/**
 * Renders the "Donate / Drop Off" section inside the org detail modal.
 * Only shown when donations_accepted = true.
 * 
 * @param {object} org - The organization record from the DB
 * @returns {string} HTML string
 */
function renderDonationSection(org) {
  if (!org.donations_accepted) return '';

  const needs = org.current_needs?.length
    ? `<div class="jh-current-needs">
         <div class="jh-needs-label">Currently needed:</div>
         <div class="jh-needs-tags">
           ${org.current_needs.map(n => `<span class="jh-need-tag">${n}</span>`).join('')}
         </div>
       </div>`
    : '';

  const types = org.donation_types?.length
    ? `<p class="jh-modal-note">Accepts: ${org.donation_types.join(', ')}</p>`
    : '';

  const dropOff = org.donation_drop_address
    ? `<p class="jh-modal-note">Drop-off: ${org.donation_drop_address}${org.donation_hours ? ` — ${org.donation_hours}` : ''}</p>`
    : '';

  const links = [];
  if (org.donation_url) {
    links.push(`<a href="${org.donation_url}" target="_blank" rel="noopener" class="jh-detail-link">Donate online →</a>`);
  }

  return `
    <div class="jh-modal-section jh-donation-section">
      <div class="jh-modal-section-label">
        <span class="jh-section-icon">📦</span> Donate / Drop Off
      </div>
      ${needs}
      ${types}
      ${dropOff}
      ${org.donation_notes ? `<p class="jh-modal-note">${org.donation_notes}</p>` : ''}
      <div class="jh-detail-links">
        ${links.join('\n        ')}
      </div>
    </div>
  `;
}


// ═══════════════════════════════════════════════════════════════
// C. PARTY OF YOU — COMMUNITY EVENT BUILDER
//    New event type in the Party of You event dashboard:
//    "Community Service Event" — links to a Just Help organization
//    and builds the event around that org's volunteer/donation info
// ═══════════════════════════════════════════════════════════════

/**
 * Community event data structure — extends the base event object
 * with Just Help integration fields.
 *
 * Stored in the `events` table with event_type = 'community_service'
 * and community_data JSONB field.
 */
const COMMUNITY_EVENT_SCHEMA = {
  // Inherited from base events table:
  // id, candidate_id, title, event_type, description
  // start_time, end_time, location_name, address, city, state, zip
  // is_public, rsvp_count, max_attendees

  // New fields for community service events:
  just_help_org_id: null,       // ID of the linked Just Help organization
  just_help_org_name: null,     // Cached name (for display without DB join)
  just_help_org_phone: null,    // Cached for the event detail page
  just_help_org_address: null,  // Cached for directions

  event_subtype: null,          // 'volunteer_day' | 'donation_drive' | 'both'

  // For volunteer days:
  volunteer_task: null,         // "Sorting food donations, stocking shelves"
  volunteer_slots: null,        // Max volunteers the org can accommodate
  min_age: null,                // Minimum age requirement
  what_to_bring: null,          // "Wear closed-toe shoes, bring water"
  what_to_wear: null,

  // For donation drives:
  donation_items_requested: [], // ['canned beans', 'peanut butter', 'diapers size 3-4']
  campaign_office_dropoff: true, // Whether candidate's office accepts donations too
  campaign_office_address: null,

  // Auto-generated event description template:
  // "We're volunteering at [Org Name] on [Date] from [Time] to [Time].
  //  Join us! [Volunteer task description]
  //  Can't make it? Drop non-perishable items at our campaign office at [address]."
};

/**
 * Generates the public event page description from community event data.
 * Used for both the campaign website event page and RSVP emails.
 */
function generateCommunityEventDescription(event, orgData) {
  const dateStr = new Date(event.start_time).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const startStr = new Date(event.start_time).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  const endStr = event.end_time
    ? ' to ' + new Date(event.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  let body = '';

  if (event.community_data?.event_subtype === 'volunteer_day' || event.community_data?.event_subtype === 'both') {
    body += `We'll be at ${orgData.name} on ${dateStr} from ${startStr}${endStr}, `;
    body += `${event.community_data.volunteer_task || 'volunteering with the team'}. `;
    body += `We'd love for you to join us. `;
    if (event.community_data.what_to_bring) {
      body += `What to bring: ${event.community_data.what_to_bring}. `;
    }
    if (event.community_data.min_age) {
      body += `Volunteers must be ${event.community_data.min_age}+. `;
    }
    body += '\n\n';
  }

  if (event.community_data?.event_subtype === 'donation_drive' || event.community_data?.event_subtype === 'both') {
    const items = event.community_data?.donation_items_requested;
    if (items?.length) {
      body += `Can't make it in person? We're also collecting donations for ${orgData.name}. `;
      body += `Most needed right now: ${items.join(', ')}. `;
    }
    if (event.community_data?.campaign_office_dropoff && event.community_data?.campaign_office_address) {
      body += `Drop items off at our campaign office: ${event.community_data.campaign_office_address}. `;
    }
  }

  return body.trim();
}


// ═══════════════════════════════════════════════════════════════
// D. EVENT SIGNUP FLOW — VOLUNTEER DATA COLLECTION
//    The RSVP form on the candidate's website for community events
// ═══════════════════════════════════════════════════════════════

/**
 * RSVP form fields for community service events.
 * Rendered on the candidate's public event page.
 * Standard name/email/phone, plus the opt-in checkbox.
 */
const COMMUNITY_EVENT_RSVP_FIELDS = [
  {
    id: 'name',
    label: 'Your name',
    type: 'text',
    required: true,
    placeholder: 'First and last name',
  },
  {
    id: 'email',
    label: 'Email address',
    type: 'email',
    required: true,
    placeholder: 'you@example.com',
  },
  {
    id: 'phone',
    label: 'Phone number',
    type: 'tel',
    required: false,
    placeholder: 'Optional — for event day updates',
  },
  {
    id: 'party_size',
    label: 'How many people are you bringing?',
    type: 'number',
    required: false,
    min: 1,
    max: 20,
    defaultValue: 1,
  },
  // THE KEY CHECKBOX — opt into future volunteer communications
  {
    id: 'future_volunteer_opt_in',
    type: 'checkbox',
    label: 'Keep me in the loop about future volunteer events and ways to get involved with this campaign.',
    required: false,
    defaultChecked: false,      // Unchecked by default — clean opt-in
    helpText: 'Checking this box adds you to the campaign\'s volunteer list. You can unsubscribe at any time.',
    // When checked: adds signup to candidate's volunteers table with source = 'community_event'
    // When unchecked: stores RSVP for this event only, not added to ongoing volunteer list
  },
];

/**
 * Handles RSVP submission for a community event.
 * Route: POST /api/events/:eventId/rsvp
 */
async function handleCommunityEventRSVP(eventId, formData, candidateId, db) {
  const {
    name,
    email,
    phone,
    party_size,
    future_volunteer_opt_in,
  } = formData;

  // 1. Always create the event RSVP record
  const [firstName, ...lastParts] = name.trim().split(' ');
  const lastName = lastParts.join(' ') || '';

  await db.query(`
    INSERT INTO event_rsvps
      (event_id, name, email, phone, status, notes, created_at)
    VALUES ($1, $2, $3, $4, 'confirmed', $5, NOW())
  `, [
    eventId,
    name.trim(),
    email.trim().toLowerCase(),
    phone?.trim() || null,
    party_size > 1 ? `Party of ${party_size}` : null,
  ]);

  // 2. If opted in, add to the candidate's volunteer list
  if (future_volunteer_opt_in) {
    await db.query(`
      INSERT INTO volunteers
        (candidate_id, name, email, phone, status, skills, signed_up_at)
      VALUES ($1, $2, $3, $4, 'active', $5, NOW())
      ON CONFLICT (candidate_id, email)
      DO UPDATE SET
        status = 'active',
        phone = COALESCE(EXCLUDED.phone, volunteers.phone),
        last_contact = NOW()
    `, [
      candidateId,
      name.trim(),
      email.trim().toLowerCase(),
      phone?.trim() || null,
      JSON.stringify(['community_events']), // Tag them as community event volunteers
    ]);

    // Log the source so the candidate knows how this volunteer found them
    await db.query(`
      INSERT INTO volunteer_source_log
        (candidate_id, email, source_type, source_id, created_at)
      VALUES ($1, $2, 'community_event_rsvp', $3, NOW())
      ON CONFLICT DO NOTHING
    `, [candidateId, email.trim().toLowerCase(), eventId]);
  }

  // 3. Send confirmation email (via SendGrid)
  // Confirmation includes:
  //   - Event details (date, time, location, what to bring)
  //   - Just Help org info (address, phone)
  //   - Unsubscribe link if they opted into future comms
  return {
    success: true,
    addedToVolunteerList: !!future_volunteer_opt_in,
  };
}


// ═══════════════════════════════════════════════════════════════
// E. SUMMARY OF ALL DB CHANGES NEEDED
// ═══════════════════════════════════════════════════════════════

const ALL_DB_CHANGES = `
-- ── IN JUST HELP's DATABASE ──────────────────────────────────

${JUST_HELP_SCHEMA_ADDITIONS}

-- ── IN PARTY OF YOU's DATABASE ───────────────────────────────

-- Add community event fields to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS community_data JSONB;

-- Widget config table (already in schema.sql additions above)
CREATE TABLE IF NOT EXISTS candidate_widget_configs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id  UUID REFERENCES candidates(id) ON DELETE CASCADE,
  widget_type   TEXT NOT NULL,
  enabled       BOOLEAN DEFAULT false,
  placement     TEXT,
  config        JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, widget_type)
);

-- Candidate website pages (for dedicated Community Resources page)
CREATE TABLE IF NOT EXISTS candidate_site_pages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id  UUID REFERENCES candidates(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  title         TEXT,
  page_type     TEXT DEFAULT 'custom',
  nav_visible   BOOLEAN DEFAULT true,
  nav_label     TEXT,
  sort_order    INTEGER DEFAULT 0,
  content       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, slug)
);

-- Track how volunteers found the campaign
CREATE TABLE IF NOT EXISTS volunteer_source_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id  UUID REFERENCES candidates(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  source_type   TEXT,  -- 'community_event_rsvp' | 'website_signup' | 'door_knock' | etc.
  source_id     UUID,  -- event_id, etc.
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, email, source_type, source_id)
);

-- Add source tracking to volunteers table
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'direct';
-- 'direct' | 'community_event_rsvp' | 'website_form' | 'door_knock' | 'phone_bank'
`;

module.exports = {
  renderVolunteerSection,
  renderDonationSection,
  generateCommunityEventDescription,
  handleCommunityEventRSVP,
  COMMUNITY_EVENT_RSVP_FIELDS,
  COMMUNITY_EVENT_SCHEMA,
  ALL_DB_CHANGES,
  JUST_HELP_SCHEMA_ADDITIONS,
};
