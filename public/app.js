class GazeKeyboard {
    constructor() {
        this.isTracking = false;
        this.keys = [];
        this.currentGazeKey = null;
        this.dwellStartTime = null;
        this.dwellTimeout = 600; // ms
        this.cooldownUntil = 0;
        this.typedText = '';
        this.showingPredictions = false;
        
        // Gaze smoothing
        this.smoothedGaze = { x: 0, y: 0 };
        this.smoothingFactor = 0.15;
        
        // Calibration state (use WebGazer's built-in click-based training)
        this.calibrationActive = false;
        this.currentCalibTargetPx = null;
        this.currentCalibSamples = [];
        this.wasTrackingBeforeCalibration = false;
        
        this.init();
    }
    
    init() {
        console.log('Initializing GazeKeyboard...');
        this.createKeyboard();
        console.log('Keyboard created');
        this.setupEventListeners();
        console.log('Event listeners set up');
        this.updateKeyRects();
        console.log('Key rects updated');
        
        // Initialize WebGazer
        this.setupWebGazer();
        console.log('WebGazer setup initiated');
    }
    
    createKeyboard() {
        const keyboard = document.getElementById('keyboard');
        const layout = [
            ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
            ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'BACKSPACE'],
            ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'TEXT']
        ];
        
        layout.forEach(row => {
            row.forEach(key => {
                const button = document.createElement('button');
                button.className = 'key';
                button.dataset.key = key;
                
                if (key === 'SPACE') {
                    button.textContent = 'Space';
                    button.classList.add('space');
                } else if (key === 'TEXT') {
                    button.textContent = 'Text';
                    button.classList.add('text');
                } else if (key === 'BACKSPACE') {
                    button.textContent = '⌫';
                    button.classList.add('backspace');
                } else {
                    button.textContent = key;
                }
                
                // Allow mouse/touch interaction for testing
                button.addEventListener('click', () => this.selectKey(key));
                
                keyboard.appendChild(button);
            });
        });
    }
    
    setupEventListeners() {
        // Start/Stop button - use both click and mousedown for reliability
        const startStopBtn = document.getElementById('startStop');
        if (!startStopBtn) {
            console.error('Start/Stop button not found!');
            return;
        }
        
        console.log('Setting up Start/Stop button listener');
        
        // Multiple event types to ensure it works
        startStopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Start/Stop button clicked');
            this.toggleTracking();
        });
        
        startStopBtn.addEventListener('mousedown', (e) => {
            console.log('Start/Stop button mousedown');
        });
        
        // Ensure button is clickable
        startStopBtn.style.pointerEvents = 'auto';
        startStopBtn.style.zIndex = '1000';
        
        // Calibration button
        document.getElementById('calibrate').addEventListener('click', () => {
            this.startCalibration();
        });
        
        // Reset calibration button
        const resetBtn = document.getElementById('resetCalibration');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetCalibration());
        }
        
        // Dwell time slider
        const dwellRange = document.getElementById('dwellRange');
        const dwellValue = document.getElementById('dwellValue');
        dwellRange.addEventListener('input', (e) => {
            this.dwellTimeout = parseInt(e.target.value);
            dwellValue.textContent = `${this.dwellTimeout}ms`;
        });
        
        // Window resize
        window.addEventListener('resize', () => this.updateKeyRects());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.updateKeyRects(), 100);
        });
    }
    
    setupWebGazer() {
        if (typeof webgazer === 'undefined') {
            console.error('WebGazer not loaded');
            return;
        }
        
        webgazer
            .setRegression('weightedRidge')
            .setTracker('clmtrackr')
            .applyKalmanFilter(true)
            .saveDataAcrossSessions(true)
            .showVideo(false)  // Hide the video feed by default; shown during calibration
            .showPredictionPoints(true)
            .setGazeListener((data, timestamp) => {
                if (data && this.isTracking) {
                    this.handleGaze(data, timestamp);
                }
            })
            .begin({
                video: true,
                videoViewer: true
            })
            .then(() => {
                console.log('WebGazer initialized successfully');
                // Don't pause initially - let it start
                // Prefer front camera at 720p for better eye patch quality
                try {
                    if (webgazer.params && webgazer.params.videoSettings) {
                        webgazer.params.videoSettings.video = {
                            width: { ideal: 1280 },
                            height: { ideal: 720 },
                            frameRate: { ideal: 30 },
                            facingMode: 'user'
                        };
                    }
                } catch (e) {
                    console.warn('Could not set camera constraints:', e);
                }
            })
            .catch(err => {
                console.error('WebGazer initialization failed:', err);
                this.showError('Camera permission denied or WebGazer failed to initialize');
            });
    }
    
    toggleTracking() {
        const button = document.getElementById('startStop');
        console.log('toggleTracking called, current state:', this.isTracking);
        if (this.calibrationActive) {
            this.showError('Finish calibration before changing tracking state');
            return;
        }
        
        if (typeof webgazer === 'undefined') {
            console.error('WebGazer not available');
            this.showError('WebGazer not loaded properly');
            return;
        }
        
        if (this.isTracking) {
            this.isTracking = false;
            webgazer.pause();
            webgazer.showPredictionPoints(false);
            button.textContent = 'Start Tracking';
            this.clearGazeHighlight();
            console.log('Tracking stopped');
        } else {
            this.isTracking = true;
            webgazer.resume();
            webgazer.showPredictionPoints(true);  // Ensure red dot is visible
            button.textContent = 'Stop Tracking';
            console.log('Tracking started - red dot should be visible');
        }
    }
    
    handleGaze(gaze, timestamp) {
        let x = gaze.x;
        let y = gaze.y;
        // Optional confidence gating using covariance (skip very uncertain points)
        const cov = gaze.covariance;
        if (cov && Array.isArray(cov) && cov.length >= 2 && Array.isArray(cov[0]) && Array.isArray(cov[1])) {
            const varX = Math.max(0, Number(cov[0][0]) || 0);
            const varY = Math.max(0, Number(cov[1][1]) || 0);
            const avgStd = Math.sqrt((varX + varY) / 2);
            if (avgStd > 45) {
                // Too noisy; ignore this frame
                return;
            }
        }
        // Clamp to viewport
        x = Math.max(0, Math.min(window.innerWidth, x));
        y = Math.max(0, Math.min(window.innerHeight, y));
        
        // Apply smoothing
        this.smoothedGaze.x = this.smoothedGaze.x * (1 - this.smoothingFactor) + x * this.smoothingFactor;
        this.smoothedGaze.y = this.smoothedGaze.y * (1 - this.smoothingFactor) + y * this.smoothingFactor;

        // Find key under gaze
        const gazedKey = this.findKeyUnderGaze(this.smoothedGaze.x, this.smoothedGaze.y);
        
        // Update debug info
        this.updateDebugInfo(this.smoothedGaze.x, this.smoothedGaze.y, gazedKey);
        
        // Handle dwell selection
        this.handleDwell(gazedKey, timestamp);
    }

    applyCalibrationBias(x, y) {
        if (!this.calibBiasGrid) return { x, y };
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (width <= 0 || height <= 0) return { x, y };

        const px = x / width;
        const py = y / height;

        // Clamp to [0.1, 0.9] range used by calibration points
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const xs = this.calibPerc;
        const ys = this.calibPerc;
        const pxC = clamp(px, xs[0], xs[2]);
        const pyC = clamp(py, ys[0], ys[2]);

        const findIdx = (arr, v) => {
            if (v <= arr[0]) return [0, 0, 0];
            if (v >= arr[2]) return [1, 2, 1];
            if (v <= arr[1]) return [0, 1, (v - arr[0]) / (arr[1] - arr[0])];
            return [1, 2, (v - arr[1]) / (arr[2] - arr[1])];
        };

        const [ix0, ix1, tx] = findIdx(xs, pxC);
        const [iy0, iy1, ty] = findIdx(ys, pyC);

        const b00 = this.calibBiasGrid[iy0][ix0] || { dx: 0, dy: 0 };
        const b10 = this.calibBiasGrid[iy0][ix1] || { dx: 0, dy: 0 };
        const b01 = this.calibBiasGrid[iy1][ix0] || { dx: 0, dy: 0 };
        const b11 = this.calibBiasGrid[iy1][ix1] || { dx: 0, dy: 0 };

        // Bilinear interpolation
        const lerp = (a, b, t) => a + (b - a) * t;
        const dxTop = lerp(b00.dx, b10.dx, tx);
        const dyTop = lerp(b00.dy, b10.dy, tx);
        const dxBot = lerp(b01.dx, b11.dx, tx);
        const dyBot = lerp(b01.dy, b11.dy, tx);
        const dx = lerp(dxTop, dxBot, ty);
        const dy = lerp(dyTop, dyBot, ty);

        return { x: x + dx, y: y + dy };
    }
    
    findKeyUnderGaze(x, y) {
        for (const keyData of this.keys) {
            const rect = keyData.rect;
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return keyData;
            }
        }
        return null;
    }
    
    handleDwell(gazedKey, timestamp) {
        // Disable selection while calibrating
        if (this.calibrationActive) {
            return;
        }
        // Skip if in cooldown
        if (timestamp < this.cooldownUntil) {
            return;
        }
        
        if (gazedKey && gazedKey === this.currentGazeKey) {
            // Same key - check dwell time
            if (this.dwellStartTime && (timestamp - this.dwellStartTime) >= this.dwellTimeout) {
                this.selectKey(gazedKey.key);
                this.dwellStartTime = null;
                this.cooldownUntil = timestamp + 250; // 250ms cooldown
            }
        } else {
            // Different key or no key
            this.clearGazeHighlight();
            this.currentGazeKey = gazedKey;
            this.dwellStartTime = gazedKey ? timestamp : null;
            
            if (gazedKey) {
                gazedKey.element.classList.add('gaze');
            }
        }
    }
    
    selectKey(key) {
        console.log('Selected key:', key);
        
        // Find the key element for visual feedback
        const keyElement = document.querySelector(`[data-key="${key}"]`);
        if (keyElement) {
            keyElement.classList.add('selected');
            setTimeout(() => keyElement.classList.remove('selected'), 300);
        }
        
        // Handle the key press
        if (key === 'BACK_TO_KEYBOARD') {
            this.backToKeyboard();
            return;
        }
        if (typeof key === 'string' && key.startsWith('PREDICTION_')) {
            const el = document.querySelector(`[data-key="${key}"]`);
            const text = (el && el.textContent) ? el.textContent.trim() : '';
            if (text) {
                this.selectPrediction(text);
            }
            return;
        }
        if (key === 'SPACE') {
            this.typedText += ' ';
            console.log('[SPACE]');
        } else if (key === 'TEXT') {
            this.showTextPredictions();
            return;
        } else if (key === 'BACKSPACE') {
            this.typedText = this.typedText.slice(0, -1);
            console.log('[BKSP]');
        } else {
            this.typedText += key;
            console.log(key);
        }
        
        // Update display
        document.getElementById('typed').textContent = this.typedText;
    }
    
    // Build initials array from typed letters (single A-Z per initial)
    buildInitialsFromTyped() {
        const letters = this.typedText.toUpperCase().replace(/[^A-Z]/g, '').split('');
        return letters;
    }

    // Fetch real suggestions from backend LLM module
    async fetchSuggestions() {
        const initials = this.buildInitialsFromTyped();
        if (initials.length === 0) {
            throw new Error('Type some letters first');
        }
        const res = await fetch('/api/suggest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initials, k: 5 })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Suggest request failed: ${res.status}`);
        }
        const data = await res.json();
        let list = Array.isArray(data?.results) ? data.results.map(r => r.text || r) : [];
        // Defensive padding to ensure exactly 5 options
        if (list.length < 5) {
            const seen = new Set(list.map(x => String(x).toLowerCase()));
            const fallback = this.buildFallbackCandidates(initials, 5 - list.length, seen);
            list = list.concat(fallback);
        }
        if (list.length > 5) list = list.slice(0, 5);
        return list;
    }

    buildFallbackCandidates(initialsUpper, need, seenLower) {
        const letterToWords = {
            A: ['a','and','at','all','any'], B: ['be','by','but','back','big'], C: ['can','could','come','call','case'],
            D: ['do','did','down','day','does'], E: ['even','every','each','end','early'], F: ['for','from','first','find','feel'],
            G: ['go','get','give','good','great'], H: ['he','her','his','how','here'], I: ['I','in','is','it','if'],
            J: ['just','job','join'], K: ['know','keep','kind'], L: ['like','look','let','last','long'],
            M: ['me','my','more','make','most'], N: ['not','now','no','need','next'], O: ['on','or','one','only','our'],
            P: ['put','people','part','place','point'], Q: ['quite','quick','question'], R: ['really','right','read','run','room'],
            S: ['so','she','see','some','say'], T: ['the','to','that','this','they'], U: ['up','us','use','under'],
            V: ['very','view','value'], W: ['we','with','will','was','what'], X: ['x'], Y: ['you','your','yet'], Z: ['zero','zone']
        };
        const out = [];
        let offset = 0;
        while (out.length < need && offset < need + 5) {
            const words = initialsUpper.map((ch, idx) => {
                const key = String(ch).toUpperCase();
                const list = letterToWords[key] || [key.toLowerCase()];
                return list[(idx + offset) % list.length] || list[0];
            });
            if (words.length > 0) {
                words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
            }
            const phrase = words.join(' ');
            const lower = phrase.toLowerCase();
            if (!seenLower.has(lower)) {
                seenLower.add(lower);
                out.push(phrase);
            }
            offset += 1;
        }
        return out;
    }
    
    async showTextPredictions() {
        if (this.typedText.trim() === '') {
            alert('Type some letters first, then click Text!');
            return;
        }
        
        console.log('Showing predictions for:', this.typedText);
        this.showingPredictions = true;
        // Clear the top typed display while we show predictions
        const typedEl = document.getElementById('typed');
        if (typedEl) typedEl.textContent = '';
        
        // Get predictions from backend
        let predictions = [];
        try {
            predictions = await this.fetchSuggestions();
        } catch (e) {
            console.error(e);
            this.showError(e.message || 'Failed to fetch suggestions');
            return;
        }
        
        // Hide keyboard and show predictions
        this.createPredictionUI(predictions);
        this.updateKeyRects(); // Update hit testing for new UI
    }
    
    createPredictionUI(predictions) {
        const keyboard = document.getElementById('keyboard');
        keyboard.innerHTML = '';
        keyboard.className = 'predictions-wrapper';

        // Title (top)
        const title = document.createElement('div');
        title.className = 'prediction-title';
        title.textContent = `Predictions for: "${this.typedText}"`;
        keyboard.appendChild(title);

        // Grid for options (middle)
        const grid = document.createElement('div');
        grid.className = 'predictions-grid';

        predictions.forEach((prediction, index) => {
            const button = document.createElement('button');
            button.className = 'prediction-option';
            button.dataset.key = `PREDICTION_${index}`;
            button.textContent = prediction;
            button.addEventListener('click', () => this.selectPrediction(prediction));
            grid.appendChild(button);
        });
        keyboard.appendChild(grid);

        // Back button (bottom row, full width)
        const backButton = document.createElement('button');
        backButton.className = 'prediction-option back-button';
        backButton.dataset.key = 'BACK_TO_KEYBOARD';
        backButton.textContent = '← Back to Keyboard';
        backButton.addEventListener('click', () => this.backToKeyboard());
        keyboard.appendChild(backButton);
    }
    
    selectPrediction(prediction) {
        console.log('Selected prediction:', prediction);
        // Do not persist chosen sentence or initials on top bar
        this.typedText = '';
        const typedEl = document.getElementById('typed');
        if (typedEl) typedEl.textContent = '';
        
        // Show the final sentence full-screen and play audio
        this.showFinalSentence(prediction);
        this.playTTS(prediction).catch(err => console.error('TTS error:', err));
    }

    showFinalSentence(text) {
        const keyboard = document.getElementById('keyboard');
        if (!keyboard) return;
        keyboard.innerHTML = '';
        keyboard.className = 'final-wrapper';

        const content = document.createElement('div');
        content.className = 'final-content';

        const bigText = document.createElement('div');
        bigText.className = 'final-text';
        bigText.textContent = text;

        content.appendChild(bigText);
        keyboard.appendChild(content);

        // Update hit testing areas
        this.updateKeyRects();

        // Auto-return to keyboard after 5 seconds
        setTimeout(() => this.backToKeyboard(), 5000);
    }

    // Call backend TTS and play the audio in browser
    async playTTS(text) {
        const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `TTS request failed: ${res.status}`);
        }
        const arrayBuffer = await res.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play().catch(err => console.error('Audio play failed:', err));
    }
    
    backToKeyboard() {
        console.log('Returning to keyboard');
        this.showingPredictions = false;
        
        // Recreate the keyboard
        const keyboard = document.getElementById('keyboard');
        keyboard.innerHTML = '';
        keyboard.className = '';
        
        this.createKeyboard();
        this.updateKeyRects();
    }
    
    clearGazeHighlight() {
        if (this.currentGazeKey) {
            this.currentGazeKey.element.classList.remove('gaze');
        }
    }
    
    updateKeyRects() {
        this.keys = [];
        document.querySelectorAll('.key, .prediction-option').forEach(element => {
            this.keys.push({
                element: element,
                key: element.dataset.key,
                rect: element.getBoundingClientRect()
            });
        });
    }
    
    updateDebugInfo(x, y, gazedKey) {
        const debug = document.getElementById('debug');
        const keyName = gazedKey ? gazedKey.key : 'none';
        debug.textContent = `Gaze: (${Math.round(x)}, ${Math.round(y)}) | Key: ${keyName}`;
    }
    
    startCalibration() {
        const dots = document.getElementById('calibrationDots');
        dots.style.display = 'block';
        dots.innerHTML = '';
        // Remove any existing gaze highlight from keys
        this.clearGazeHighlight();

        // Disable control buttons during calibration
        const startStopBtn = document.getElementById('startStop');
        const calibrateBtn = document.getElementById('calibrate');
        const resetBtn = document.getElementById('resetCalibration');
        if (startStopBtn) startStopBtn.disabled = true;
        if (calibrateBtn) calibrateBtn.disabled = true;
        if (resetBtn) resetBtn.disabled = true;

        // Show video feed during calibration only and hide prediction points
        try { webgazer.showVideo(true); } catch (e) {}
        try { webgazer.showPredictionPoints(false); } catch (e) {}
        // Ensure tracking is running to collect samples
        if (typeof webgazer !== 'undefined') {
            this.wasTrackingBeforeCalibration = this.isTracking;
            this.isTracking = true;
            try { webgazer.resume(); } catch (e) {}
            try { webgazer.showPredictionPoints(true); } catch (e) {}
        }
        this.calibrationActive = true;
        this.currentCalibTargetPx = null;
        this.currentCalibSamples = [];

        // 9-point calibration with 2 clicks per dot
        const positions = [
            { x: '10%', y: '10%' }, { x: '50%', y: '10%' }, { x: '90%', y: '10%' },
            { x: '10%', y: '50%' }, { x: '50%', y: '50%' }, { x: '90%', y: '50%' },
            { x: '10%', y: '90%' }, { x: '50%', y: '90%' }, { x: '90%', y: '90%' }
        ];

        let currentDot = 0;
        let clicksOnDot = 0;
        const collectedBias = Array(3).fill(0).map(() => Array(3).fill(0).map(() => ({ dx: 0, dy: 0 })));

        const progress = document.createElement('div');
        progress.className = 'calibration-progress';
        progress.textContent = 'Calibration: 0 / 18';
        dots.appendChild(progress);

        const showNextDot = () => {
            if (currentDot >= positions.length) {
                dots.style.display = 'none';
                dots.innerHTML = '';
                try { webgazer.showVideo(false); } catch (e) {}
                this.calibrationActive = false;
                this.currentCalibTargetPx = null;
                this.currentCalibSamples = [];
                // End of calibration; WebGazer has captured click samples internally

                // Re-enable buttons
                const startStopBtn2 = document.getElementById('startStop');
                const calibrateBtn2 = document.getElementById('calibrate');
                const resetBtn2 = document.getElementById('resetCalibration');
                if (startStopBtn2) startStopBtn2.disabled = false;
                if (calibrateBtn2) calibrateBtn2.disabled = false;
                if (resetBtn2) resetBtn2.disabled = false;

                // Restore tracking state to what it was before calibration
                try {
                    if (!this.wasTrackingBeforeCalibration) {
                        this.isTracking = false;
                        webgazer.pause();
                        try { webgazer.showPredictionPoints(false); } catch (e) {}
                        if (startStopBtn2) startStopBtn2.textContent = 'Start Tracking';
                    } else {
                        this.isTracking = true;
                        try { webgazer.showPredictionPoints(true); } catch (e) {}
                        if (startStopBtn2) startStopBtn2.textContent = 'Stop Tracking';
                    }
                } catch (e) {}
                return;
            }

            // Render current dot
            const dot = document.createElement('div');
            dot.className = 'calibration-dot';
            dot.style.left = positions[currentDot].x;
            dot.style.top = positions[currentDot].y;
            dot.style.transform = 'translate(-50%, -50%)';

            // Rely on WebGazer built-in click-based calibration; no manual target math

            const handleDotClick = () => {
                clicksOnDot++;
                progress.textContent = `Calibration: ${currentDot * 2 + clicksOnDot} / 18`;
                if (clicksOnDot >= 2) {
                    // advance to next dot
                    clicksOnDot = 0;
                    currentDot++;
                    // Clear and show next
                    dots.innerHTML = '';
                    dots.appendChild(progress);
                    setTimeout(showNextDot, 400);
                } else {
                    // brief visual feedback
                    dot.classList.add('clicked-once');
                }
            };

            dot.addEventListener('click', handleDotClick);

            // Reset container and append
            dots.innerHTML = '';
            dots.appendChild(progress);
            dots.appendChild(dot);
        };

        showNextDot();
    }

    resetCalibration() {
        if (this.calibrationActive) {
            this.showError('Cannot reset during calibration');
            return;
        }
        try {
            if (webgazer && typeof webgazer.clearData === 'function') {
                webgazer.clearData();
                this.showError('Calibration data cleared. Please recalibrate.');
            }
        } catch (e) {
            console.warn('Failed to clear WebGazer data:', e);
        }
    }
    
    showError(message) {
        const status = document.getElementById('status');
        status.innerHTML = `<div style="color: red; font-weight: bold;">${message}</div>`;
    }
}

// Initialize when page loads
window.addEventListener('load', () => {
    new GazeKeyboard();
});


