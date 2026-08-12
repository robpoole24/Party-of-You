/**
 * VIDEO AD CREATOR — MODULE 9
 * 
 * AI-powered political ad generator for Party of You candidates.
 * 
 * Philosophy:
 *   - Every claim grounded in verifiable data (FEC, GovTrack, OpenSecrets)
 *   - Consequence framing by default: not "voted against X" but "here's who that hurts"
 *   - Candidates choose their angle, their provider, their style
 *   - No corporate attack ad aesthetics — honest, direct, human
 * 
 * Video Providers:
 *   RUNWAY     → Cinematic b-roll, documentary style, high production value
 *   VEO        → Highest quality cinematic, native audio sync, Google infrastructure
 *   KLING      → Character/subject consistency across shots, great for narratives
 *   HEYGEN     → Talking-head spokesperson, direct-to-camera, candidate avatar
 *   ELEVENLABS → Voiceover narration for footage-based ads (no avatar needed)
 * 
 * Flow:
 *   1. Candidate fills ad brief (issue, opponent vote, target audience, tone)
 *   2. Claude API generates script + visual direction + fact-check layer
 *   3. Candidate reviews and edits script
 *   4. Candidate selects video provider based on ad style
 *   5. Video renders async via selected provider
 *   6. Candidate downloads + posts to their social channels
 */

const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────
// AD STYLES — What each provider is best for
// Shown to candidates as options in the UI
// ─────────────────────────────────────────────────

const AD_STYLES = {
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic / Documentary',
    description: 'Professional b-roll footage with voiceover narration. High production value. Best for issue-focused ads showing real-world consequences.',
    bestFor: ['issue contrast', 'emotional storytelling', 'community impact'],
    defaultProvider: 'runway',
    alternateProvider: 'veo',
    typicalLength: '30-60 seconds',
    examplePrompt: 'Working families in a small American town, tight on money, choosing between groceries and medication',
  },
  spokesperson: {
    id: 'spokesperson',
    label: 'Direct to Camera / Spokesperson',
    description: 'AI avatar delivers the message directly to viewers. Personal, trustworthy. Works when the candidate or a community member speaks directly.',
    bestFor: ['candidate introduction', 'personal endorsements', 'direct contrast'],
    defaultProvider: 'heygen',
    alternateProvider: null,
    typicalLength: '15-45 seconds',
    examplePrompt: null,
  },
  narrative: {
    id: 'narrative',
    label: 'Story / Character Journey',
    description: 'Follows a consistent subject or character through a short story. Tracks a person\'s situation before and after a policy decision.',
    bestFor: ['policy impact stories', 'voter testimonials', 'before/after framing'],
    defaultProvider: 'kling',
    alternateProvider: 'runway',
    typicalLength: '30-60 seconds',
    examplePrompt: 'A nurse working a double shift, exhausted, knowing her patient can\'t afford the prescriptions being cut from Medicaid',
  },
  highImpact: {
    id: 'highImpact',
    label: 'High Quality / Premium',
    description: 'Google Veo\'s highest-fidelity output with native audio. When you need maximum visual quality and the budget to match.',
    bestFor: ['launch ads', 'major announcements', 'viral potential'],
    defaultProvider: 'veo',
    alternateProvider: null,
    typicalLength: '15-30 seconds',
    examplePrompt: null,
  },
};

// ─────────────────────────────────────────────────
// PROVIDER REGISTRY
// ─────────────────────────────────────────────────

const VIDEO_PROVIDERS = {

  runway: {
    id: 'runway',
    name: 'Runway Gen-4.5',
    description: 'Industry-standard cinematic AI video. Best creative control, professional editing tools, motion brushes. The filmmaker\'s choice.',
    costPer10Seconds: '$1.50',
    costNote: '~$0.15/sec via API',
    signupUrl: 'https://dev.runwayml.com',
    keyName: 'RUNWAY_API_KEY',
    enabled: () => !!process.env.RUNWAY_API_KEY && process.env.VIDEO_PROVIDER_RUNWAY_ENABLED === 'true',
    supportsAudio: false,
    maxDurationSeconds: 60,
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    models: {
      standard: 'gen4_turbo',    // Faster, lower cost
      premium: 'gen4',           // Flagship quality
    },
  },

  veo: {
    id: 'veo',
    name: 'Google Veo 3.1',
    description: 'Google DeepMind\'s flagship video model. Highest fidelity output, native audio generation. Premium quality for high-stakes ads.',
    costPer10Seconds: '$1.00 (Fast) – $7.50 (Standard)',
    costNote: '$0.10/sec (Fast 720p) or $0.75/sec (Standard with audio)',
    signupUrl: 'https://console.cloud.google.com/vertex-ai',
    keyName: 'GOOGLE_CLOUD_PROJECT_ID',
    enabled: () => !!process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.VIDEO_PROVIDER_VEO_ENABLED === 'true',
    supportsAudio: true,
    maxDurationSeconds: 8,   // Per clip — chain for longer
    supportedAspectRatios: ['16:9', '9:16'],
    models: {
      fast: 'veo-3.1-fast-generate-001',       // $0.10/sec, 720p
      standard: 'veo-3.1-generate-001',         // $0.40/sec with audio, 1080p
    },
  },

  kling: {
    id: 'kling',
    name: 'Kling AI 3.0',
    description: 'Excellent subject and character consistency across shots. Best for narrative ads that follow a person or situation through a story.',
    costPer10Seconds: '$1.00',
    costNote: '~$0.10/sec (Kling 3.0 Standard)',
    signupUrl: 'https://kling.ai/dev',
    keyName: 'KLING_API_KEY',
    enabled: () => !!process.env.KLING_API_KEY && process.env.VIDEO_PROVIDER_KLING_ENABLED === 'true',
    supportsAudio: true,
    maxDurationSeconds: 10,
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    models: {
      standard: 'kling-v3-standard',
      pro: 'kling-v3-pro',
    },
  },

  heygen: {
    id: 'heygen',
    name: 'HeyGen Avatar V',
    description: 'AI spokesperson / talking-head video. Create a digital avatar from a photo. Candidate speaks directly to voters without filming.',
    costPer10Seconds: '$0.50',
    costNote: '$0.05/sec ($3/min) for Avatar V quality',
    signupUrl: 'https://heygen.com',
    keyName: 'HEYGEN_API_KEY',
    enabled: () => !!process.env.HEYGEN_API_KEY && process.env.VIDEO_PROVIDER_HEYGEN_ENABLED === 'true',
    supportsAudio: true,   // Lip-synced to script
    maxDurationSeconds: 300,
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    models: {
      standard: 'avatar_v4',
      premium: 'avatar_v5',
    },
  },

};

// ─────────────────────────────────────────────────
// STEP 1: SCRIPT GENERATION (Claude API)
// ─────────────────────────────────────────────────

/**
 * Generate an ad script with visual direction and fact-check layer
 * 
 * @param {object} brief - AdBrief from the candidate's form submission
 * @returns {object} AdScript with script, visuals, facts, and sourcing
 */
async function generateAdScript(brief) {
  const {
    candidateName,
    district,
    issue,           // e.g., "Medicaid funding cuts"
    opponentName,
    opponentAction,  // e.g., "voted to cut $880B from Medicaid (H.R. 1, May 2025)"
    opponentSource,  // FEC vote ID, GovTrack link, etc.
    targetAudience,  // e.g., "working families, seniors, people with disabilities"
    tone,            // 'urgent' | 'hopeful' | 'direct' | 'devastating'
    adStyle,         // from AD_STYLES keys
    durationSeconds, // 15 | 30 | 45 | 60
  } = brief;

  const systemPrompt = `You are a political ad scriptwriter for Party of You, a platform supporting 
grassroots independent candidates who take no corporate money and answer only to working-class voters.

Your job is to write ads that do what establishment political consultants are too timid to do:
tell voters EXACTLY what a policy means in their lives. Not abstract votes — real consequences.

CORE PRINCIPLES:
1. Consequence framing: Never say "voted against X." Say "here's who gets hurt and how."
2. Specificity: Use real numbers, real district data, real people who are affected.
3. Source everything: Every factual claim must have a citation.
4. Human dignity: The people in these ads are not statistics — they're neighbors.
5. No corporate aesthetic: No slick consultant language. Direct. Human. True.
6. The contrast must be earned: We don't lie about opponents. We let their actual record speak.

OUTPUT FORMAT — return valid JSON only, no markdown:
{
  "script": {
    "openingHook": "First 3 seconds — the image or statement that stops the scroll",
    "body": "The core 80% of the ad — the consequence story",
    "callToAction": "Final 5 seconds — what you want viewers to do or feel"
  },
  "visualDirection": [
    {
      "timeCode": "0:00-0:03",
      "shot": "Description of the visual for the video AI prompt",
      "videoPrompt": "Exact prompt to send to the video generation API",
      "notes": "Any specific guidance for this shot"
    }
  ],
  "voiceover": "Complete narration text (if narrator-driven ad)",
  "onScreenText": ["Text overlay 1", "Text overlay 2"],
  "factCheckLayer": [
    {
      "claim": "The specific claim made in the ad",
      "source": "FEC vote ID, GovTrack URL, news report URL, or data source",
      "verifiedDate": "Date last verified",
      "directUrl": "Clickable URL to source"
    }
  ],
  "toneNotes": "Brief note on why this tone serves this audience",
  "warningFlags": ["Any claims that need additional verification before publishing"]
}`;

  const userPrompt = `Write a ${durationSeconds}-second political ad with these parameters:

CANDIDATE: ${candidateName}, running in ${district}
ISSUE: ${issue}
OPPONENT ACTION: ${opponentAction}
SOURCE FOR OPPONENT ACTION: ${opponentSource}
TARGET AUDIENCE: ${targetAudience}
TONE: ${tone}
AD STYLE: ${AD_STYLES[adStyle]?.description || adStyle}

Key context: Our candidates take NO corporate money, NO PAC money. Only small-dollar donations from real people.
The opponent is funded by [the interests that benefit from this policy]. That contrast matters.

Write the script so that a working family watching this ad understands:
1. What their representative actually did (with source)
2. What it means for people exactly like them in ${district}
3. That there's an alternative — someone who actually works for them

Do not be gentle. Do not hedge. Do not use consultant language.
Be specific. Be true. Be damning where the record is damning.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: systemPrompt,
  });

  const rawText = response.content[0].text;

  try {
    // Strip any markdown code blocks if present
    const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();
    const script = JSON.parse(cleaned);
    return {
      success: true,
      script,
      brief,
      generatedAt: new Date().toISOString(),
      model: 'claude-sonnet-4-6',
    };
  } catch (e) {
    return {
      success: false,
      error: 'Script generation returned non-JSON response',
      rawResponse: rawText,
      brief,
    };
  }
}

// ─────────────────────────────────────────────────
// STEP 2: VIDEO GENERATION — PER PROVIDER
// ─────────────────────────────────────────────────

/**
 * Generate video from a script using the selected provider
 * Returns a job ID for async polling — video generation takes 1-10 minutes
 */
async function generateVideo(script, providerKey, options = {}) {
  const provider = VIDEO_PROVIDERS[providerKey];

  if (!provider) throw new Error(`Unknown provider: ${providerKey}`);
  if (!provider.enabled()) throw new Error(`Provider ${providerKey} is not enabled or key is missing`);

  const aspectRatio = options.aspectRatio || '16:9';
  const duration = Math.min(options.durationSeconds || 30, provider.maxDurationSeconds);

  switch (providerKey) {
    case 'runway':
      return generateViaRunway(script, provider, { aspectRatio, duration });
    case 'veo':
      return generateViaVeo(script, provider, { aspectRatio, duration });
    case 'kling':
      return generateViaKling(script, provider, { aspectRatio, duration });
    case 'heygen':
      return generateViaHeyGen(script, provider, { aspectRatio, duration });
    default:
      throw new Error(`No generator implemented for: ${providerKey}`);
  }
}

// ── RUNWAY ────────────────────────────────────────

async function generateViaRunway(script, provider, options) {
  // Runway generates one clip at a time — we chain multiple for longer ads
  const shots = script.visualDirection || [];
  const jobs = [];

  for (const shot of shots) {
    const response = await axios.post(
      'https://api.dev.runwayml.com/v1/image_to_video',
      {
        model: provider.models.standard,
        prompt_text: shot.videoPrompt,
        duration: Math.min(10, options.duration), // Runway max 10s per clip
        ratio: options.aspectRatio === '9:16' ? '720:1280' : '1280:720',
        seed: null,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}`,
          'X-Runway-Version': '2024-11-06',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    jobs.push({
      taskId: response.data.id,
      shotDescription: shot.shot,
      timeCode: shot.timeCode,
      provider: 'runway',
      status: 'pending',
    });

    // Small delay between shots
    await sleep(500);
  }

  return {
    provider: 'runway',
    jobType: 'multi-shot',
    shots: jobs,
    status: 'rendering',
    estimatedMinutes: shots.length * 2,
    note: 'Each shot renders separately and will be assembled into final ad',
  };
}

// ── VEO ───────────────────────────────────────────

async function generateViaVeo(script, provider, options) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = process.env.VEO_LOCATION || 'us-central1';
  const modelId = options.useAudio ? provider.models.standard : provider.models.fast;

  // Build the combined prompt from all shots
  const combinedPrompt = script.visualDirection
    ?.map(s => s.videoPrompt)
    .join('. ') || script.script?.body || '';

  const requestBody = {
    model: modelId,
    instances: [{
      prompt: combinedPrompt,
      ...(options.aspectRatio === '9:16' && { aspect_ratio: 'PORTRAIT' }),
    }],
    parameters: {
      sampleCount: 1,
      durationSeconds: Math.min(options.duration, provider.maxDurationSeconds),
      includeRaiReason: true,
    },
  };

  // Vertex AI uses Application Default Credentials
  // In Railway, set GOOGLE_APPLICATION_CREDENTIALS to the path of a service account JSON
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`;

  const response = await axios.post(endpoint, requestBody, {
    headers: {
      'Content-Type': 'application/json',
      // Auth handled by Google's ADC — use googleapis library in production
    },
    timeout: 30000,
  });

  return {
    provider: 'veo',
    operationName: response.data.name,
    status: 'rendering',
    estimatedMinutes: 3,
    pollUrl: `https://${location}-aiplatform.googleapis.com/v1/${response.data.name}`,
    note: 'Veo generates the full scene. For ads over 8 seconds, multiple clips are chained.',
  };
}

// ── KLING ─────────────────────────────────────────

async function generateViaKling(script, provider, options) {
  const shots = script.visualDirection || [];
  const jobs = [];

  for (const shot of shots) {
    const response = await axios.post(
      'https://api.kling.ai/v1/videos/text2video',
      {
        model_name: provider.models.standard,
        prompt: shot.videoPrompt,
        negative_prompt: 'blurry, distorted, unrealistic, stock footage aesthetic, corporate, polished ad',
        cfg_scale: 0.5,
        mode: 'std',  // 'std' or 'pro'
        duration: Math.min(options.duration, 10).toString(), // Kling: "5" or "10"
        aspect_ratio: options.aspectRatio === '9:16' ? '9:16' : '16:9',
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.KLING_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    jobs.push({
      taskId: response.data.data?.task_id,
      shotDescription: shot.shot,
      timeCode: shot.timeCode,
      provider: 'kling',
      status: 'pending',
    });

    await sleep(500);
  }

  return {
    provider: 'kling',
    jobType: 'multi-shot',
    shots: jobs,
    status: 'rendering',
    estimatedMinutes: shots.length * 3,
    note: 'Kling excels at keeping consistent characters across shots.',
  };
}

// ── HEYGEN (Spokesperson) ─────────────────────────

async function generateViaHeyGen(script, provider, options) {
  // HeyGen requires:
  // 1. An avatar ID (candidate's uploaded photo, or stock avatar)
  // 2. The voiceover script text
  // 3. A voice ID (from HeyGen's voice library or candidate's voice clone)

  const voiceoverText = script.voiceover || buildVoiceoverFromScript(script.script);

  const response = await axios.post(
    'https://api.heygen.com/v2/video/generate',
    {
      video_inputs: [{
        character: {
          type: 'avatar',
          avatar_id: options.avatarId || 'default_professional_v5',
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          input_text: voiceoverText,
          voice_id: options.voiceId || 'default_authoritative',
          speed: 0.95,
        },
        background: {
          type: 'color',
          value: '#1a1a2e', // Dark blue — adjustable
        },
      }],
      dimension: {
        width: options.aspectRatio === '9:16' ? 720 : 1280,
        height: options.aspectRatio === '9:16' ? 1280 : 720,
      },
      aspect_ratio: options.aspectRatio,
      test: false,
    },
    {
      headers: {
        'X-Api-Key': process.env.HEYGEN_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  return {
    provider: 'heygen',
    videoId: response.data.data?.video_id,
    status: 'rendering',
    estimatedMinutes: 2,
    note: 'HeyGen generates a full-length spokesperson video with lip-sync.',
  };
}

// ─────────────────────────────────────────────────
// STEP 3: POLL FOR COMPLETION
// ─────────────────────────────────────────────────

/**
 * Check render status for a video job
 * Call this from a Bull queue job on a 30-second interval
 */
async function pollVideoStatus(job) {
  switch (job.provider) {
    case 'runway':
      return pollRunwayStatus(job);
    case 'veo':
      return pollVeoStatus(job);
    case 'kling':
      return pollKlingStatus(job);
    case 'heygen':
      return pollHeyGenStatus(job);
    default:
      throw new Error(`No poll handler for: ${job.provider}`);
  }
}

async function pollRunwayStatus(job) {
  const response = await axios.get(
    `https://api.dev.runwayml.com/v1/tasks/${job.taskId}`,
    {
      headers: { 'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}` },
    }
  );

  const task = response.data;
  return {
    status: task.status === 'SUCCEEDED' ? 'complete' : task.status === 'FAILED' ? 'failed' : 'pending',
    videoUrl: task.output?.[0],
    error: task.failure || null,
  };
}

async function pollVeoStatus(job) {
  const response = await axios.get(job.pollUrl, {
    headers: { 'Content-Type': 'application/json' },
  });

  const operation = response.data;
  if (operation.done) {
    const videoUrl = operation.response?.predictions?.[0]?.bytesBase64Encoded
      ? null  // Handle base64 response — upload to R2 storage
      : operation.response?.predictions?.[0]?.gcsUri;

    return {
      status: operation.error ? 'failed' : 'complete',
      videoUrl,
      error: operation.error?.message || null,
    };
  }

  return { status: 'pending' };
}

async function pollKlingStatus(job) {
  const response = await axios.get(
    `https://api.kling.ai/v1/videos/text2video/${job.taskId}`,
    {
      headers: { 'Authorization': `Bearer ${process.env.KLING_API_KEY}` },
    }
  );

  const task = response.data?.data;
  return {
    status: task?.task_status === 'succeed' ? 'complete' : task?.task_status === 'failed' ? 'failed' : 'pending',
    videoUrl: task?.task_result?.videos?.[0]?.url,
    error: task?.task_status_msg || null,
  };
}

async function pollHeyGenStatus(job) {
  const response = await axios.get(
    `https://api.heygen.com/v1/video_status.get?video_id=${job.videoId}`,
    {
      headers: { 'X-Api-Key': process.env.HEYGEN_API_KEY },
    }
  );

  const data = response.data?.data;
  return {
    status: data?.status === 'completed' ? 'complete' : data?.status === 'failed' ? 'failed' : 'pending',
    videoUrl: data?.video_url,
    thumbnailUrl: data?.thumbnail_url,
    error: data?.error || null,
  };
}

// ─────────────────────────────────────────────────
// PROVIDER COST ESTIMATOR
// Shown to candidates before they commit to generation
// ─────────────────────────────────────────────────

/**
 * Estimate cost for a given provider + duration combination
 * Returns a cost estimate with breakdown shown to candidate before generation
 */
function estimateCost(providerKey, durationSeconds, options = {}) {
  const estimates = {
    runway: {
      costPerSecond: 0.15,
      model: 'Gen-4.5',
      notes: 'Multi-shot generation. Each 10s clip is ~$1.50. Final assembly is free.',
    },
    veo: {
      costPerSecond: options.useAudio ? 0.40 : 0.10,
      model: options.useAudio ? 'Veo 3.1 Standard (with audio)' : 'Veo 3.1 Fast (720p)',
      notes: 'Per-clip pricing. 8s max per generation. Clips are chained for longer ads.',
    },
    kling: {
      costPerSecond: 0.10,
      model: 'Kling 3.0 Standard',
      notes: 'Per-shot pricing. Best for character-consistent narrative ads.',
    },
    heygen: {
      costPerSecond: 0.05,
      model: 'Avatar V',
      notes: 'Full-video generation including lip-sync. No per-shot complexity.',
    },
  };

  const est = estimates[providerKey];
  if (!est) return null;

  const baseCost = est.costPerSecond * durationSeconds;
  const estimatedCost = Math.ceil(baseCost * 100) / 100; // Round up to nearest cent

  return {
    provider: VIDEO_PROVIDERS[providerKey]?.name,
    model: est.model,
    durationSeconds,
    estimatedCost: `$${estimatedCost.toFixed(2)}`,
    costBreakdown: `${durationSeconds}s × $${est.costPerSecond}/sec`,
    notes: est.notes,
    recommendation: getProviderRecommendation(providerKey, durationSeconds),
  };
}

function getProviderRecommendation(providerKey, duration) {
  if (providerKey === 'veo' && duration > 8) {
    return `Veo generates 8s clips max. Your ${duration}s ad will need ${Math.ceil(duration / 8)} clips chained together.`;
  }
  if (providerKey === 'heygen' && duration > 60) {
    return 'For ads over 60 seconds, consider breaking into multiple clips.';
  }
  if (providerKey === 'runway' && duration <= 10) {
    return 'For short 10s clips, Runway is excellent and cost-effective.';
  }
  return null;
}

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

function buildVoiceoverFromScript(script) {
  if (!script) return '';
  return [script.openingHook, script.body, script.callToAction]
    .filter(Boolean)
    .join(' ');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────

module.exports = {
  // Core workflow
  generateAdScript,
  generateVideo,
  pollVideoStatus,
  estimateCost,

  // Reference data for the UI
  AD_STYLES,
  VIDEO_PROVIDERS,

  // Helper: get available providers (keys exist + enabled)
  getAvailableProviders: () => {
    return Object.values(VIDEO_PROVIDERS).filter(p => p.enabled());
  },

  // Helper: get all providers with status (for dashboard display)
  getAllProvidersWithStatus: () => {
    return Object.values(VIDEO_PROVIDERS).map(p => ({
      ...p,
      isAvailable: p.enabled(),
      enabled: undefined, // Remove function reference before serializing
    }));
  },
};
