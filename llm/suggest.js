import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-4.1';

function validateInitials(initials) {
    if (!Array.isArray(initials) || initials.length === 0) {
        throw new Error('initials must be a non-empty array of single letters');
    }
    const cleaned = initials.map((ch) => {
        if (typeof ch !== 'string') {
            throw new Error('Each initial must be a string');
        }
        const trimmed = ch.trim();
        if (trimmed.length !== 1 || !/^[a-zA-Z]$/.test(trimmed)) {
            throw new Error(`Invalid initial: "${ch}". Expected a single letter A-Z.`);
        }
        return trimmed.toUpperCase();
    });
    return cleaned;
}

function isValidCandidateForInitials(candidate, initialsUpper) {
    if (typeof candidate !== 'string') return false;
    const words = candidate.trim().split(/\s+/);
    if (words.length !== initialsUpper.length) return false;
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const required = initialsUpper[i];
        if (word.length === 0) return false;
        if (word[0].toUpperCase() !== required) return false;
    }
    return true;
}

async function generateCandidates(client, initialsUpper, k, model, temperature) {
    const initialsStr = initialsUpper.join(' ');
    const nWords = initialsUpper.length;
    const system = 'You are an expert in English word frequency and common collocations. Produce the most statistically likely, natural-sounding sentences that match strict initial constraints. Output JSON only.';
    const user = [
        `Task: Return ${k} sentences where each sentence has exactly ${nWords} words and the words start with these initials (in order): ${initialsStr}`,
        '',
        'Constraints:',
        '- Use the MOST FREQUENT English words for each initial (case-insensitive).',
        '- Prefer combinations that commonly appear together in everyday English (collocations).',
        '- Favor simple function words when appropriate (the, a, and, to, is, it, you, etc.).',
        '- Avoid awkward sequences of mostly function words that do not form natural phrases (e.g., "the and she").',
        '- Avoid proper nouns, rare words, and technical terms.',
        '- No punctuation, numbering, or commentary; do not add periods.',
        '',
        'Process (do this silently): Brainstorm at least 20 candidate phrases, estimate their likelihood by frequency and collocation strength, then return only the top-ranked results.',
        '',
        'Positive guidance examples (do not copy):',
        '- H T D → "He took down", "He told dad"',
        '- I L Y → "I love you", "I like you"',
        '- T A S → "To a school", "That is safe" (avoid "The and she")',
        '',
        `Return STRICT JSON only: { "candidates": [ "...", "..." ] }`
    ].join('\n');

    const completion = await client.chat.completions.create({
        model,
        temperature,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ],
        // Encourage JSON-only outputs on supported models
        response_format: { type: 'json_object' }
    });

    const content = completion.choices?.[0]?.message?.content || '';
    let data;
    try {
        data = JSON.parse(content);
    } catch {
        // Try to salvage JSON substring
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error('Model did not return JSON candidates');
        }
        data = JSON.parse(match[0]);
    }
    const list = Array.isArray(data?.candidates) ? data.candidates : [];

    // Validate and dedupe
    const seen = new Set();
    const valid = [];
    for (const cand of list) {
        if (!isValidCandidateForInitials(cand, initialsUpper)) continue;
        const norm = cand.trim();
        if (seen.has(norm.toLowerCase())) continue;
        seen.add(norm.toLowerCase());
        valid.push(norm);
    }
    if (valid.length === 0) {
        throw new Error('No valid candidates matched the hard constraints');
    }
    return valid.slice(0, k);
}

async function scoreSentenceLogProb(client, text, model) {
    // Best-effort simple likelihood proxy using token logprobs from a deterministic repeat
    const res = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
            { role: 'system', content: 'Repeat the user message exactly. Output nothing else.' },
            { role: 'user', content: text }
        ],
        logprobs: true,
        top_logprobs: 0,
        max_tokens: 64
    });
    const content = res.choices?.[0]?.message?.content ?? '';
    const tokens = res.choices?.[0]?.logprobs?.content ?? [];
    if (!Array.isArray(tokens) || tokens.length === 0) {
        return { text: content || text, score: null };
    }
    let sum = 0;
    let count = 0;
    for (const t of tokens) {
        if (typeof t?.logprob === 'number') {
            sum += t.logprob;
            count += 1;
        }
    }
    if (count === 0) return { text, score: null };
    const avgLogProb = sum / count;
    const prob = Math.exp(avgLogProb);
    return { text, score: prob };
}

// Simple fallback words per initial letter (very common words first)
const LETTER_TO_COMMON_WORDS = {
    A: ['a', 'and', 'at', 'all', 'any'],
    B: ['be', 'by', 'but', 'back', 'big'],
    C: ['can', 'could', 'come', 'call', 'case'],
    D: ['do', 'did', 'down', 'day', 'does'],
    E: ['even', 'every', 'each', 'end', 'early'],
    F: ['for', 'from', 'first', 'find', 'feel'],
    G: ['go', 'get', 'give', 'good', 'great'],
    H: ['he', 'her', 'his', 'how', 'here'],
    I: ['I', 'in', 'is', 'it', 'if'],
    J: ['just', 'job', 'join', 'keep'],
    K: ['know', 'keep', 'kind'],
    L: ['like', 'look', 'let', 'last', 'long'],
    M: ['me', 'my', 'more', 'make', 'most'],
    N: ['not', 'now', 'no', 'need', 'next'],
    O: ['on', 'or', 'one', 'only', 'our'],
    P: ['put', 'people', 'part', 'place', 'point'],
    Q: ['quite', 'quick', 'question'],
    R: ['really', 'right', 'read', 'run', 'room'],
    S: ['so', 'she', 'see', 'some', 'say'],
    T: ['the', 'to', 'that', 'this', 'they'],
    U: ['up', 'us', 'use', 'under'],
    V: ['very', 'view', 'value'],
    W: ['we', 'with', 'will', 'was', 'what'],
    X: ['x'],
    Y: ['you', 'your', 'yet'],
    Z: ['zero', 'zone']
};

function buildFallbackPhrase(initialsUpper, variantOffset = 0) {
    const words = initialsUpper.map((ch, idx) => {
        const list = LETTER_TO_COMMON_WORDS[ch] || [ch.toLowerCase()];
        const pick = list[(idx + variantOffset) % list.length] || list[0];
        return pick;
    });
    // Capitalize first word for nicer look
    if (words.length > 0) {
        words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    }
    return words.join(' ');
}

function buildFallbackCandidates(initialsUpper, need, existingLowerSet) {
    const results = [];
    let offset = 0;
    while (results.length < need && offset < need + 5) {
        const phrase = buildFallbackPhrase(initialsUpper, offset);
        const key = phrase.toLowerCase();
        if (!existingLowerSet.has(key)) {
            existingLowerSet.add(key);
            results.push(phrase);
        }
        offset += 1;
    }
    return results;
}

export async function suggestSentencesFromInitials(initials, options = {}) {
    const initialsUpper = validateInitials(initials);

    const {
        k = 5,
        model = DEFAULT_MODEL,
        temperature = 0.2,
        includeScores = true
    } = options;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
        throw new Error('Missing OPENAI_API_KEY. Create a .env from .env.example and set it.');
    }
    const client = new OpenAI({ apiKey });

    // Try to get more than needed to improve chances of valid set
    let poolSize = Math.max(k * 3, k + 2);
    let attempts = 0;
    const maxAttempts = 2;
    let candidates = [];
    while (attempts <= maxAttempts && candidates.length < k) {
        const gen = await generateCandidates(client, initialsUpper, poolSize, model, temperature);
        const combined = new Set([...(candidates || []), ...gen]);
        candidates = Array.from(combined);
        attempts += 1;
        poolSize += 2;
    }
    // If still short, pad with deterministic fallbacks to guarantee k
    if (candidates.length < k) {
        const lowerSet = new Set(candidates.map(c => c.toLowerCase()));
        const needed = k - candidates.length;
        const fallbacks = buildFallbackCandidates(initialsUpper, needed, lowerSet);
        candidates = candidates.concat(fallbacks);
    }
    // Ensure exactly k
    candidates = candidates.slice(0, k);

    if (!includeScores) {
        return candidates.map((text) => ({ text }));
    }

    const scored = await Promise.all(
        candidates.map((c) => scoreSentenceLogProb(client, c, model).catch(() => ({ text: c, score: null })))
    );

    // Sort by score desc when available, otherwise keep original order
    const withRank = scored.map((s, i) => ({ ...s, _i: i }));
    withRank.sort((a, b) => {
        if (a.score == null && b.score == null) return a._i - b._i;
        if (a.score == null) return 1;
        if (b.score == null) return -1;
        return b.score - a.score;
    });
    return withRank.map(({ text, score }) => ({ text, score }));
}

export default suggestSentencesFromInitials;

