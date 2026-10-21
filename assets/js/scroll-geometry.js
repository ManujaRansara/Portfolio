(() => {
    'use strict';

    const canvas = document.getElementById('particle-canvas');
    const ctx = canvas && canvas.getContext('2d', { alpha: true });
    if (!canvas || !ctx) return;

    const root = document.documentElement;
    const profileImage = document.getElementById('profile-photo');
    const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const FALLBACK_HUE = 218;
    const SHAPE_COUNT = 4;
    let accent = { r: 30, g: 105, b: 225 };
    let width = 1;
    let height = 1;
    let dpr = 1;
    let flakes = [];
    let frameId = 0;
    let reducedMotion = reduceMotionQuery.matches;
    let targetScroll = window.scrollY || 0;
    let easedScroll = targetScroll;
    let previousFrameTime = performance.now();

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const mod = (n, m) => ((n % m) + m) % m;
    const smoothstep = t => t * t * (3 - 2 * t);

    function rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (delta !== 0) {
            s = delta / (1 - Math.abs(2 * l - 1));
            switch (max) {
                case r: h = ((g - b) / delta) % 6; break;
                case g: h = (b - r) / delta + 2; break;
                default: h = (r - g) / delta + 4;
            }
            h *= 60;
            if (h < 0) h += 360;
        }
        return { h, s, l };
    }

    function hslToRgb(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let rr = 0, gg = 0, bb = 0;

        if (h < 60) [rr, gg, bb] = [c, x, 0];
        else if (h < 120) [rr, gg, bb] = [x, c, 0];
        else if (h < 180) [rr, gg, bb] = [0, c, x];
        else if (h < 240) [rr, gg, bb] = [0, x, c];
        else if (h < 300) [rr, gg, bb] = [x, 0, c];
        else [rr, gg, bb] = [c, 0, x];

        return {
            r: Math.round((rr + m) * 255),
            g: Math.round((gg + m) * 255),
            b: Math.round((bb + m) * 255)
        };
    }

    function setPalette(r, g, b) {
        const hsl = rgbToHsl(r, g, b);
        // Keep neutral/grey/white portrait backgrounds from producing a washed-out accent.
        const hue = hsl.s < 0.14 ? FALLBACK_HUE : hsl.h;
        const saturation = hsl.s < 0.14 ? 0.58 : clamp(hsl.s * 0.9, 0.42, 0.8);
        accent = hslToRgb(hue, saturation, 0.48);
        const dark = hslToRgb(hue, Math.min(0.88, saturation + 0.08), 0.25);

        root.style.setProperty('--profile-photo-rgb', `${r}, ${g}, ${b}`);
        root.style.setProperty('--profile-accent-rgb', `${accent.r}, ${accent.g}, ${accent.b}`);
        root.style.setProperty('--profile-accent', `rgb(${accent.r}, ${accent.g}, ${accent.b})`);
        root.style.setProperty('--profile-accent-dark', `rgb(${dark.r}, ${dark.g}, ${dark.b})`);
        root.style.setProperty('--profile-accent-soft', `rgba(${accent.r}, ${accent.g}, ${accent.b}, .16)`);
    }

    function sampleProfilePalette(image) {
        if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return;

        try {
            const sample = document.createElement('canvas');
            const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
            if (!sampleCtx) return;
            const sampleSize = 96;
            sample.width = sampleSize;
            sample.height = sampleSize;
            sampleCtx.drawImage(image, 0, 0, sampleSize, sampleSize);
            const pixels = sampleCtx.getImageData(0, 0, sampleSize, sampleSize).data;
            const bins = new Map();

            // Sample the perimeter only, which is more likely to contain the photo background.
            for (let y = 0; y < sampleSize; y += 2) {
                for (let x = 0; x < sampleSize; x += 2) {
                    const edgeDistance = Math.min(x, y, sampleSize - 1 - x, sampleSize - 1 - y);
                    if (edgeDistance > 9) continue;
                    const i = (y * sampleSize + x) * 4;
                    if (pixels[i + 3] < 150) continue;

                    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
                    const key = `${Math.round(r / 28)}-${Math.round(g / 28)}-${Math.round(b / 28)}`;
                    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
                    bin.count++;
                    bin.r += r;
                    bin.g += g;
                    bin.b += b;
                    bins.set(key, bin);
                }
            }

            let best = null;
            for (const bin of bins.values()) {
                if (!best || bin.count > best.count) best = bin;
            }
            if (best && best.count) {
                setPalette(
                    Math.round(best.r / best.count),
                    Math.round(best.g / best.count),
                    Math.round(best.b / best.count)
                );
            }
        } catch (error) {
            // Some browser/security configurations block pixel reads. Keep the blue fallback.
            console.info('Profile palette sampling skipped; using the fallback accent.', error);
        }
    }

    function accentRgba(alpha) {
        return `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${alpha})`;
    }

    function makeSnowflakes() {
        const count = clamp(Math.round((width * height) / 16500), width < 600 ? 18 : 38, width < 600 ? 30 : 90);
        flakes = Array.from({ length: count }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            size: 0.8 + Math.random() * 1.7,
            speed: 0.07 + Math.random() * 0.23,
            drift: 0.05 + Math.random() * 0.20,
            depth: 0.35 + Math.random() * 0.85,
            alpha: 0.2 + Math.random() * 0.38,
            angle: Math.random() * Math.PI * 2,
            phase: Math.random() * Math.PI * 2
        }));
    }

    function resizeCanvas() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = Math.max(1, window.innerWidth);
        height = Math.max(1, window.innerHeight);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        makeSnowflakes();
        render(performance.now());
    }

    // Four non-spherical mathematical structures, normalized for smooth morphing.
    function surfacePoint(shape, u, t, phase) {
        const v = 2 * Math.PI * t;

        // 1. Torus-knot-inspired loop
        if (shape === 0) {
            const p = 2;
            const q = 3;
            const ring = 0.48 + 0.16 * Math.cos(q * u);

            return {
                x: ring * Math.cos(p * u),
                y: ring * Math.sin(p * u),
                z: 0.22 * Math.sin(q * u + phase * 0.12)
            };
        }

        // 2. Möbius strip
        if (shape === 1) {
            const across = (2 * t - 1) * 0.29;
            const ring = 0.58 + across * Math.cos(u / 2);

            return {
                x: ring * Math.cos(u),
                y: ring * Math.sin(u),
                z: across * Math.sin(u / 2)
            };
        }

        // 3. Hyperbolic saddle surface, wrapped into a continuous parameter grid
        if (shape === 2) {
            const a = (t - 0.5) * 1.35;
            const b = (u / (2 * Math.PI) - 0.5) * 1.35;

            return {
                x: a,
                y: b,
                z: 0.72 * (a * a - b * b)
            };
        }

        // 4. Klein-bottle-inspired twisted surface (not a mathematically exact embedding)
        const tube = 0.20 + 0.055 * Math.sin(3 * u + phase);
        const ring = 0.48 + tube * Math.cos(v);

        return {
            x: ring * Math.cos(u),
            y: ring * Math.sin(u),
            z: tube * Math.sin(v) + 0.12 * Math.sin(2 * u + v + phase)
        };
    }

    function transformPoint(point, centerX, centerY, size, angleX, angleY) {
        const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
        const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
        const x1 = point.x * cosY - point.z * sinY;
        const z1 = point.x * sinY + point.z * cosY;
        const y2 = point.y * cosX - z1 * sinX;
        const z2 = point.y * sinX + z1 * cosX;
        const perspective = 3.1 / (3.1 + z2);
        return {
            x: centerX + x1 * size * perspective,
            y: centerY + y2 * size * perspective,
            depth: clamp((z2 + 1.25) / 2.5, 0.12, 1)
        };
    }

    function drawGeometry(centerX, centerY, size, scrollPhase, time, baseAlpha, offset = 0) {
        const phase = scrollPhase + offset;
        const wholePhase = Math.floor(phase);
        const shapeA = mod(wholePhase, SHAPE_COUNT);
        const shapeB = mod(shapeA + 1, SHAPE_COUNT);
        const blend = smoothstep(phase - wholePhase);
        const angleY = time * 0.17 + phase * 0.48 + offset * 0.22;
        const angleX = -0.32 + Math.sin(time * 0.23 + phase * 0.8) * 0.22;
        const uCount = width < 600 ? 24 : 34;
        const vCount = width < 600 ? 12 : 17;
        const grid = [];

        for (let j = 0; j <= vCount; j++) {
            const row = [];
            const t = j / vCount;
            for (let i = 0; i <= uCount; i++) {
                const u = (i / uCount) * Math.PI * 2;
                const p1 = surfacePoint(shapeA, u, t, time + phase);
                const p2 = surfacePoint(shapeB, u, t, time + phase + 0.6);
                const p = {
                    x: p1.x + (p2.x - p1.x) * blend,
                    y: p1.y + (p2.y - p1.y) * blend,
                    z: p1.z + (p2.z - p1.z) * blend
                };
                row.push(transformPoint(p, centerX, centerY, size, angleX, angleY));
            }
            grid.push(row);
        }

        ctx.lineWidth = width < 600 ? 0.65 : 0.8;
        ctx.strokeStyle = `rgba(25, 35, 50, ${baseAlpha})`;
        ctx.beginPath();

        // Lines around the surface.
        for (let j = 0; j <= vCount; j++) {
            const row = grid[j];
            ctx.moveTo(row[0].x, row[0].y);
            for (let i = 1; i <= uCount; i++) ctx.lineTo(row[i].x, row[i].y);
        }

        // Lines across the surface.
        for (let i = 0; i <= uCount; i += 2) {
            ctx.moveTo(grid[0][i].x, grid[0][i].y);
            for (let j = 1; j <= vCount; j++) ctx.lineTo(grid[j][i].x, grid[j][i].y);
        }
        ctx.stroke();

        // Subtle nodes, with reduced opacity to keep the geometry understated.
        ctx.fillStyle = `rgba(25, 35, 50, ${Math.min(baseAlpha * 1.25, 0.35)})`;
        for (let j = 1; j < vCount; j += 3) {
            for (let i = 0; i < uCount; i += 3) {
                const p = grid[j][i];
                ctx.globalAlpha = 0.35 + p.depth * 0.55;
                ctx.beginPath();
                ctx.arc(p.x, p.y, width < 600 ? 0.8 : 1.05, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawSnowflake(flake, time) {
        const size = flake.size * (0.82 + flake.depth * 0.22);
        ctx.save();
        ctx.translate(flake.x, flake.y);
        ctx.rotate(flake.angle + Math.sin(time * 0.16 + flake.phase) * 0.22);
        ctx.strokeStyle = accentRgba(flake.alpha);
        ctx.fillStyle = accentRgba(flake.alpha * 1.15);
        ctx.lineWidth = size > 2 ? 0.72 : 0.55;
        ctx.lineCap = 'round';

        // Six crystalline arms, with short split branches.
        for (let arm = 0; arm < 6; arm++) {
            const a = arm * Math.PI / 3;
            const ux = Math.cos(a), uy = Math.sin(a);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(ux * size, uy * size);
            ctx.stroke();

            const branchDistance = size * 0.57;
            const branchLength = size * 0.28;
            const bx = ux * branchDistance;
            const by = uy * branchDistance;
            const sideA = a + 0.72;
            const sideB = a - 0.72;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - Math.cos(sideA) * branchLength, by - Math.sin(sideA) * branchLength);
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - Math.cos(sideB) * branchLength, by - Math.sin(sideB) * branchLength);
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0.45, size * 0.12), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function render(now) {
        const dt = clamp((now - previousFrameTime) / 16.667, 0, 2.5);
        previousFrameTime = now;
        ctx.clearRect(0, 0, width, height);

        easedScroll += (targetScroll - easedScroll) * (reducedMotion ? 1 : 0.085);
        const scrollPhase = easedScroll / Math.max(height * 0.88, 1);
        const time = now * 0.001;

        // Main geometry retains its original size and position.
        const mainSize = width < 600
            ? Math.min(width * 0.42, height * 0.28, 135)
            : Math.min(width * 0.34, height * 0.45, 320);
        const mainX = width * (width < 600 ? 0.76 : 0.80);
        const mainY = height * (0.62 + 0.045 * Math.sin(scrollPhase * 0.52 + time * 0.12));
        drawGeometry(mainX, mainY, mainSize, scrollPhase, time, width < 600 ? 0.20 : 0.24, 0);

        // Secondary geometry retains its original size and position.
        if (width >= 760) {
            const secondarySize = Math.min(width * 0.24, height * 0.32, 340);
            const secondaryX = width * 0.18;
            const secondaryY = height * (0.65 + 0.04 * Math.cos(scrollPhase * 0.45 + time * 0.1));
            drawGeometry(secondaryX, secondaryY, secondarySize, scrollPhase, time, 0.12, 1.45);
        }

        // Snow drifts independently, with its breeze subtly influenced by scroll position.
        const wind = Math.sin(time * 0.32 + scrollPhase * 0.38) * 0.42;
        for (const flake of flakes) {
            if (!reducedMotion) {
                flake.y += flake.speed * flake.depth * dt;
                flake.x += (wind * flake.depth + Math.sin(time * 0.52 + flake.phase) * flake.drift) * dt;
                flake.angle += 0.0018 * flake.depth * dt;
            }
            if (flake.y > height + 12) {
                flake.y = -12;
                flake.x = Math.random() * width;
            }
            if (flake.x < -12) flake.x = width + 12;
            if (flake.x > width + 12) flake.x = -12;
            drawSnowflake(flake, time);
        }
    }

    function animate(now) {
        render(now);
        if (!reducedMotion) frameId = window.requestAnimationFrame(animate);
        else frameId = 0;
    }

    function requestRender() {
        targetScroll = window.scrollY || 0;
        if (reducedMotion) render(performance.now());
    }

    function handleMotionPreferenceChange(event) {
        reducedMotion = event.matches;
        if (frameId) window.cancelAnimationFrame(frameId);
        frameId = 0;
        previousFrameTime = performance.now();
        if (!reducedMotion) frameId = window.requestAnimationFrame(animate);
        else render(performance.now());
    }

    // Set a stable accent immediately, then sample the profile image if possible.
    setPalette(30, 105, 225);
    if (profileImage) {
        if (profileImage.complete) sampleProfilePalette(profileImage);
        else profileImage.addEventListener('load', () => sampleProfilePalette(profileImage), { once: true });
    }

    targetScroll = window.scrollY || 0;
    easedScroll = targetScroll;
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { passive: true });
    window.addEventListener('scroll', requestRender, { passive: true });

    if (typeof reduceMotionQuery.addEventListener === 'function') {
        reduceMotionQuery.addEventListener('change', handleMotionPreferenceChange);
    } else if (typeof reduceMotionQuery.addListener === 'function') {
        reduceMotionQuery.addListener(handleMotionPreferenceChange);
    }

    if (!reducedMotion) frameId = window.requestAnimationFrame(animate);
})();