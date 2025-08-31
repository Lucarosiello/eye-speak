import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Text-to-Speech via ElevenLabs REST API
// Design choices for this app:
// - Output: return an in-memory Buffer AND optionally write to disk when outputPath is provided.
//   Rationale: the UI will likely play audio directly in-memory; saving is useful for debugging/exports.
// - Defaults: modelId = "eleven_multilingual_v2" (quality), outputFormat = "mp3_44100_128" (common),
//   voiceId = provided by you (9HDbqtW72sb3bAep4FjI). All are overridable via options.
// - Env: reads ELEVENLABS_API_KEY from ./config/.env; this module does not call dotenv itself to keep concerns separated.
// - Errors: throws on validation or API errors (no silent failures).

const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const DEFAULT_VOICE_ID = '9HDbqtW72sb3bAep4FjI';

function assertEnv() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
        throw new Error('Missing ELEVENLABS_API_KEY. Ensure it is set in ./config/.env');
    }
    return apiKey;
}

function ensureDirForFile(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

export async function textToSpeech(sentence, options = {}) {
    // Validate inputs early
    if (typeof sentence !== 'string' || sentence.trim().length === 0) {
        throw new Error('sentence must be a non-empty string');
    }

    const apiKey = assertEnv();
    const {
        voiceId = DEFAULT_VOICE_ID,
        modelId = DEFAULT_MODEL_ID,
        outputFormat = DEFAULT_OUTPUT_FORMAT,
        outputPath // optional
    } = options;

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

    const body = {
        text: sentence,
        model_id: modelId,
        output_format: outputFormat
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        let details = '';
        try {
            details = await res.text();
        } catch (_) {}
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText} ${details}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (outputPath) {
        ensureDirForFile(outputPath);
        fs.writeFileSync(outputPath, buffer);
    }

    return {
        buffer,
        mimeType: 'audio/mpeg',
        path: outputPath || null
    };
}

export default textToSpeech;


