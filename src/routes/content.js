const express = require('express');
const router = express.Router();

const PROMPTS = {
  press_release: (c) => `Write a campaign announcement press release for ${c.name} running for ${c.office} in ${c.state}. Progressive platform: universal healthcare, workers rights, housing affordability, climate action, ending endless wars, no corporate PAC money. Third person. Include a candidate quote. Under 400 words.`,
  letter_editor: (c) => `Write a letter to the editor from ${c.name} announcing candidacy for ${c.office} in ${c.state}. Why they ran: frustration with status quo, commitment to working people, no corporate money. 250 words max. First person.`,
  interview_prep: (c) => `Interview talking points for ${c.name}, progressive candidate for ${c.office} in ${c.state}. Include: 3 key messages, 5 hard questions with strong answers, 30-second closing statement.`,
  social_announce: (c) => `3 social media announcement posts for ${c.name} running for ${c.office} in ${c.state}:\n1. Twitter/X (280 chars)\n2. Facebook (3 paragraphs)\n3. Instagram with hashtags\nNo corporate money, progressive platform.`,
  social_issue: (c) => `Social posts about healthcare as a human right from ${c.name}, candidate for ${c.office} in ${c.state}.\n1. Twitter (280 chars)\n2. Facebook (2-3 paragraphs with call to action)`,
  social_volunteer: (c) => `Volunteer recruitment posts for ${c.name}'s campaign for ${c.office} in ${c.state}.\n1. Twitter\n2. Facebook\n3. Instagram with hashtags\nMention door knocking, phone banking, events.`,
  door_script: (c) => `Door-knock script for ${c.name} for ${c.office} in ${c.state}. Include: opening (10 sec), pitch (30 sec), 3 objections with responses, the ask, how to log result. Conversational, not robotic.`,
  phone_script: (c) => `Phone banking script for ${c.name}'s campaign for ${c.office} in ${c.state}. Include: opening, pitch, issue survey, voter ID, volunteer ask, graceful exit. Natural and human.`,
  pitch: (c) => `30-second stump speech for ${c.name} running for ${c.office} in ${c.state}. No corporate money. Punchy, spoken aloud, clear call to action.`,
  video_intro: (c) => `60-second video ad script for ${c.name} for ${c.office} in ${c.state}. Scene descriptions in [brackets], spoken narration labeled, B-roll suggestions. Documentary style.`,
  video_contrast: (c) => `30-second contrast ad for ${c.name} for ${c.office} in ${c.state} vs incumbent on healthcare and working families. Scene directions included. Factual, not personal.`,
  video_issue: (c) => `45-second housing affordability explainer for ${c.name}, candidate for ${c.office} in ${c.state}. Working family story, causes, solution. Scene directions included.`,
};

router.post('/generate', async (req, res) => {
  const { type, candidateContext } = req.body;

  if (!type || !PROMPTS[type]) {
    return res.status(400).json({ error: `Unknown content type: ${type}` });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Content generation not configured',
      message: 'Add ANTHROPIC_API_KEY to Railway environment variables.',
    });
  }

  const c = {
    name: candidateContext?.full_name || 'the candidate',
    office: candidateContext?.office_sought || 'local office',
    state: candidateContext?.state || 'their state',
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: PROMPTS[type](c) }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(502).json({ error: 'API error', detail: err.error?.message });
    }

    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '';
    res.json({ success: true, content: text, type });
  } catch (err) {
    res.status(500).json({ error: 'Content generation failed', message: err.message });
  }
});

module.exports = router;
