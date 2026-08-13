/**
 * JUST HELP WIDGET — CANDIDATE DASHBOARD OPT-IN MODULE
 * src/modules/just-help-widget/dashboard-opt-in.js
 *
 * Handles the opt-in flow when a candidate chooses to add the
 * Just Help community resources widget to their campaign website.
 *
 * Flow:
 *   1. Candidate sees the widget offer in their Website Builder section
 *   2. They read the value prop and click "Add to My Website"
 *   3. They choose placement (dedicated page vs. sidebar widget vs. footer)
 *   4. Optional: set a default location (pre-fills their district)
 *   5. Widget embed code is injected into their campaign site template
 *   6. Preview shown before publishing
 *
 * The actual widget rendering is handled by just-help-embed.js (served
 * from /public/widgets/just-help.js). This module manages the dashboard
 * UI and the candidate's site configuration record in the DB.
 */

const express = require('express');
const router = express.Router();

// ─────────────────────────────────────────────────
// GET /api/dashboard/just-help-widget
// Returns current widget config for this candidate
// ─────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const candidateId = req.candidate.id; // Set by auth middleware

  try {
    const config = await getWidgetConfig(candidateId, req.db);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────
// POST /api/dashboard/just-help-widget/enable
// Candidate opts in — saves config, injects into site template
// ─────────────────────────────────────────────────

router.post('/enable', async (req, res) => {
  const candidateId = req.candidate.id;
  const {
    placement,       // 'page' | 'sidebar' | 'footer'
    defaultLocation, // pre-fill zip/city (defaults to candidate's district zip)
    pageTitle,       // custom title for the widget, optional
    pageSlug,        // URL slug if placement === 'page', e.g. 'community-resources'
  } = req.body;

  try {
    // Save widget config
    await req.db.query(`
      INSERT INTO candidate_widget_configs
        (candidate_id, widget_type, enabled, placement, config, created_at, updated_at)
      VALUES ($1, 'just_help', true, $2, $3, NOW(), NOW())
      ON CONFLICT (candidate_id, widget_type)
      DO UPDATE SET enabled = true, placement = $2, config = $3, updated_at = NOW()
    `, [
      candidateId,
      placement || 'page',
      JSON.stringify({
        defaultLocation: defaultLocation || null,
        pageTitle: pageTitle || 'Find Help in Our Community',
        pageSlug: pageSlug || 'community-resources',
      }),
    ]);

    // If placement is a dedicated page, add it to the candidate's site nav
    if (placement === 'page') {
      await addNavPage(candidateId, pageSlug || 'community-resources', req.db);
    }

    res.json({
      success: true,
      message: 'Community resources widget added to your campaign website.',
      embedPreview: buildEmbedCode(defaultLocation, pageTitle),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────
// POST /api/dashboard/just-help-widget/disable
// ─────────────────────────────────────────────────

router.post('/disable', async (req, res) => {
  const candidateId = req.candidate.id;
  await req.db.query(`
    UPDATE candidate_widget_configs
    SET enabled = false, updated_at = NOW()
    WHERE candidate_id = $1 AND widget_type = 'just_help'
  `, [candidateId]);

  res.json({ success: true, message: 'Widget removed from your website.' });
});

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

async function getWidgetConfig(candidateId, db) {
  const result = await db.query(`
    SELECT enabled, placement, config
    FROM candidate_widget_configs
    WHERE candidate_id = $1 AND widget_type = 'just_help'
  `, [candidateId]);

  if (!result.rows.length) {
    return { enabled: false, placement: null, config: null };
  }

  return {
    enabled: result.rows[0].enabled,
    placement: result.rows[0].placement,
    config: result.rows[0].config,
  };
}

async function addNavPage(candidateId, slug, db) {
  // Adds a "Community Resources" page to the candidate's site navigation
  await db.query(`
    INSERT INTO candidate_site_pages
      (candidate_id, slug, title, page_type, nav_visible, nav_label, sort_order, created_at)
    VALUES ($1, $2, 'Community Resources', 'just_help_widget', true, 'Community Help', 99, NOW())
    ON CONFLICT (candidate_id, slug) DO NOTHING
  `, [candidateId, slug]);
}

function buildEmbedCode(defaultLocation, pageTitle) {
  const attrs = [];
  if (pageTitle) attrs.push(`data-title="${pageTitle}"`);
  if (defaultLocation) attrs.push(`data-default-location="${defaultLocation}"`);
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';

  return `<script src="https://partyofyou.org/widgets/just-help.js"></script>
<div id="just-help-widget"${attrStr}></div>`;
}

module.exports = router;


// ─────────────────────────────────────────────────
// DASHBOARD UI DATA
// The frontend reads this to render the opt-in card
// ─────────────────────────────────────────────────

/**
 * Value proposition copy for the dashboard opt-in card.
 * Rendered in the Website Builder section under "Add Features."
 */
const WIDGET_VALUE_PROP = {
  title: 'Add Community Resources to Your Website',
  icon: '🤝',
  tagline: 'Turn your campaign website into a community resource hub.',

  whyItMatters: [
    {
      headline: 'Show voters you\'re already working for them',
      body: 'Most campaign websites are about the candidate. This makes yours about the community. Voters who find your site looking for food assistance or utility help encounter a candidate who is actively trying to solve those problems — not just promising to vote the right way.',
    },
    {
      headline: 'Build trust before Election Day',
      body: 'People who use the resource finder on your site have a direct, positive interaction with your campaign without being asked for money or a vote. That\'s the kind of contact that builds real loyalty.',
    },
    {
      headline: 'Connect your campaign to mutual aid work',
      body: 'If you\'re organizing community events — volunteering at a food bank, collecting donations, running a supply drive — those events show up in the same section of your website. Your campaign and your community work live in the same place.',
    },
    {
      headline: 'It costs nothing and takes two minutes to add',
      body: 'One click adds the widget to your site. No configuration required. It automatically shows resources near whatever location a visitor searches — anywhere in the country.',
    },
  ],

  placements: [
    {
      id: 'page',
      label: 'Dedicated Page',
      description: 'Adds a "Community Resources" page to your site navigation. Full-width widget with room for a custom introduction from you.',
      recommended: true,
    },
    {
      id: 'sidebar',
      label: 'Sidebar Widget',
      description: 'Compact version in the sidebar of your site. Visible on most pages without taking up the full layout.',
      recommended: false,
    },
    {
      id: 'footer',
      label: 'Footer',
      description: 'Minimal version in the site footer. Always present but unobtrusive.',
      recommended: false,
    },
  ],

  // DB schema addition needed:
  schemaNote: `
    ALTER TABLE candidate_widget_configs ADD COLUMN IF NOT EXISTS widget_type TEXT;
    ALTER TABLE candidate_widget_configs ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT false;
    ALTER TABLE candidate_widget_configs ADD COLUMN IF NOT EXISTS placement TEXT;
    ALTER TABLE candidate_widget_configs ADD COLUMN IF NOT EXISTS config JSONB;
    ALTER TABLE candidate_site_pages ADD COLUMN IF NOT EXISTS page_type TEXT;

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
  `,
};

module.exports.WIDGET_VALUE_PROP = WIDGET_VALUE_PROP;
