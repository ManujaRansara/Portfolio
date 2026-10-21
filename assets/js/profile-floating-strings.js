
(() => {
    'use strict';

    const container = document.querySelector(
        '#home .home__profile-container'
    );
    const frame = container?.querySelector('.home__profile-frame');

    if (!container || !frame) return;

    const motion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
    );

    container.querySelectorAll('.profile-cord-canvas')
        .forEach(el => el.remove());

    const canvas = document.createElement('canvas');
    canvas.className = 'profile-cord-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const TAU = Math.PI * 2;
    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    let width = 1;
    let height = 1;
    let dpr = 1;
    let cx = 0;
    let cy = 0;
    let radius = 100;
    let orbits = [];
    let elapsed = 0;
    let lastTime = 0;
    let animationId = 0;

    /*
     * Nuclear-inspired orbits.
     * Each path is deformed, tilted, and independently rotated.
     * Larger periods mean slower movement.
     */
    const orbitSettings = [
        { size: 1.34, aspect: 0.94, tilt: -0.40,
          inclination: 0.44, rotationPeriod: 78,
          particlePeriod: 32 },

        { size: 1.43, aspect: 0.88, tilt: 0.64,
          inclination: 0.68, rotationPeriod: 94,
          particlePeriod: 39 },

        { size: 1.55, aspect: 0.84, tilt: -0.91,
          inclination: 0.55, rotationPeriod: 86,
          particlePeriod: 35 },

        { size: 1.68, aspect: 0.98, tilt: 0.23,
          inclination: 0.77, rotationPeriod: 110,
          particlePeriod: 44 }
    ];

    function createOrbits() {
        orbits = orbitSettings.map((settings, index) => ({
            ...settings,

            rx: radius * settings.size,
            ry: radius * settings.size * settings.aspect,

            direction: index % 2 === 0 ? 1 : -1,
            phase: rand(0, TAU),

            /* Different non-circular deformations */
            warp1: rand(0.065, 0.105),
            warp2: rand(0.025, 0.055),
            warp3: rand(0.018, 0.04),

            /* Distinct travelling dots on each orbital cord */
            nodes: Array.from(
                { length: index % 2 === 0 ? 2 : 1 },
                () => ({
                    phase: rand(0, TAU),
                    size: rand(1.3, 2.0)
                })
            ),

            dotSpacing: rand(38, 53),
            dotOffset: rand(0, 25),
            lineWidth: rand(0.65, 0.95),
            opacity: rand(0.20, 0.34)
        }));
    }

    function resize() {
        const frameRect = frame.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();

        width = Math.max(1, canvasRect.width);
        height = Math.max(1, canvasRect.height);
        dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        cx = frameRect.left - canvasRect.left +
            frameRect.width / 2;

        cy = frameRect.top - canvasRect.top +
            frameRect.height / 2;

        radius = Math.max(frameRect.width, frameRect.height) / 2;

        createOrbits();
        draw(elapsed);
    }

    /*
     * Return a slowly rotating, imperfect orbital point.
     * Harmonic distortions prevent a perfect ellipse.
     */
    function orbitPoint(orbit, theta, time) {
        const phase = orbit.phase;

        const radial =
            1
            + orbit.warp1 *
                Math.sin(3 * theta + phase + time * 0.045)
            + orbit.warp2 *
                Math.cos(5 * theta - phase * 1.3 - time * 0.032)
            + orbit.warp3 *
                Math.sin(2 * theta + phase * 0.7);

        const x =
            orbit.rx * Math.cos(theta) * radial;

        const y =
            orbit.ry * Math.sin(theta) *
                (1 + 0.035 * Math.sin(3 * theta + phase))
            + orbit.rx * 0.035 *
                Math.sin(2 * theta + phase);

        /* A shallow depth component creates an inclined 3D feel */
        const z =
            orbit.rx * (
                0.12 * Math.sin(2 * theta + phase)
                + 0.05 * Math.cos(3 * theta - phase)
            );

        /* Complete a full rotation very slowly */
        const planeAngle =
            orbit.tilt +
            orbit.direction * TAU * time / orbit.rotationPeriod;

        const x1 =
            x * Math.cos(planeAngle) -
            y * Math.sin(planeAngle);

        const y1 =
            x * Math.sin(planeAngle) +
            y * Math.cos(planeAngle);

        const inclination =
            orbit.inclination +
            0.035 * Math.sin(time * 0.08 + phase);

        const y2 =
            y1 * Math.cos(inclination) -
            z * Math.sin(inclination);

        const z2 =
            y1 * Math.sin(inclination) +
            z * Math.cos(inclination);

        const perspective = 1 / (
            1 + z2 / (orbit.rx * 2.8)
        );

        return {
            x: cx + x1 * perspective,
            y: cy + y2 * perspective,
            depth: clamp(
                0.5 + z2 / (orbit.rx * 1.4),
                0.15, 0.95
            )
        };
    }

    function drawOrbit(orbit, time) {
        const steps = 280;
        const points = [];

        for (let i = 0; i <= steps; i++) {
            const theta = TAU * i / steps;
            points.push(orbitPoint(orbit, theta, time));
        }

        /* Continuous but irregular orbital cord */
        ctx.beginPath();

        points.forEach((point, index) => {
            if (index === 0) {
                ctx.moveTo(point.x, point.y);
            } else {
                ctx.lineTo(point.x, point.y);
            }
        });

        ctx.closePath();
        ctx.strokeStyle = `rgba(0,0,0,${orbit.opacity})`;
        ctx.lineWidth = orbit.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        /*
         * Small dots spaced by path length,
         * rather than evenly by angle.
         */
        let distance = orbit.dotOffset;

        for (let i = 1; i < points.length; i++) {
            const previous = points[i - 1];
            const point = points[i];

            distance += Math.hypot(
                point.x - previous.x,
                point.y - previous.y
            );

            if (distance >= orbit.dotSpacing) {
                ctx.beginPath();
                ctx.arc(
                    point.x,
                    point.y,
                    0.65,
                    0,
                    TAU
                );
                ctx.fillStyle = `rgba(0,0,0,${orbit.opacity + 0.12})`;
                ctx.fill();
                distance = 0;
            }
        }

        /* Slow-moving black particles travel on the cords */
        for (const node of orbit.nodes) {
            const theta = node.phase +
                orbit.direction * TAU * time /
                orbit.particlePeriod;

            const point = orbitPoint(orbit, theta, time);

            ctx.beginPath();
            ctx.arc(
                point.x,
                point.y,
                node.size * 1.8,
                0,
                TAU
            );

            ctx.fillStyle = 'rgba(0,0,0,0.07)';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(point.x, point.y, node.size, 0, TAU);
            ctx.fillStyle = 'rgba(0,0,0,0.62)';
            ctx.fill();
        }
    }

    function draw(time) {
        ctx.clearRect(0, 0, width, height);

        /* Outer tracks first, inner tracks on top */
        [...orbits]
            .sort((a, b) => b.size - a.size)
            .forEach(orbit => drawOrbit(orbit, time));
    }

    function animate(now) {
        if (lastTime) {
            elapsed += Math.min((now - lastTime) / 1000, 0.05);
        }

        lastTime = now;
        draw(elapsed);

        if (!motion.matches) {
            animationId = requestAnimationFrame(animate);
        } else {
            animationId = 0;
        }
    }

    function startAnimation() {
        if (animationId) {
            cancelAnimationFrame(animationId);
        }

        animationId = 0;
        lastTime = 0;

        if (motion.matches) {
            draw(elapsed);
        } else {
            animationId = requestAnimationFrame(animate);
        }
    }

    window.addEventListener('resize', resize, {
        passive: true
    });

    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(resize);
        observer.observe(container);
        observer.observe(frame);
    }

    if (motion.addEventListener) {
        motion.addEventListener('change', startAnimation);
    }

    resize();
    startAnimation();
})();
