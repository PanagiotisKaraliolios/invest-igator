'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef } from 'react';

// Register GSAP plugins
if (typeof window !== 'undefined') {
	gsap.registerPlugin(ScrollTrigger);
}

export type AnimationType =
	| 'fadeUp'
	| 'fadeDown'
	| 'fadeLeft'
	| 'fadeRight'
	| 'scaleUp'
	| 'stagger'
	| 'parallax'
	| 'reveal';

interface UseGsapOptions {
	type?: AnimationType;
	duration?: number;
	delay?: number;
	stagger?: number;
	scrub?: boolean | number;
	start?: string;
	end?: string;
	markers?: boolean;
	once?: boolean;
}

const defaultOptions: UseGsapOptions = {
	delay: 0,
	duration: 0.8,
	end: 'bottom 20%',
	markers: false,
	once: true,
	scrub: false,
	stagger: 0.1,
	start: 'top 85%',
	type: 'fadeUp'
};

export function useGsap<T extends HTMLElement = HTMLDivElement>(options: UseGsapOptions = {}) {
	const ref = useRef<T>(null);
	const opts = { ...defaultOptions, ...options };

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		const ctx = gsap.context(() => {
			const getInitialState = () => {
				switch (opts.type) {
					case 'fadeUp':
						return { opacity: 0, y: 40 };
					case 'fadeDown':
						return { opacity: 0, y: -40 };
					case 'fadeLeft':
						return { opacity: 0, x: 40 };
					case 'fadeRight':
						return { opacity: 0, x: -40 };
					case 'scaleUp':
						return { opacity: 0, scale: 0.9 };
					case 'reveal':
						return { clipPath: 'inset(0 100% 0 0)', opacity: 0 };
					default:
						return { opacity: 0, y: 40 };
				}
			};

			const getFinalState = () => {
				switch (opts.type) {
					case 'fadeUp':
					case 'fadeDown':
						return { delay: opts.delay, duration: opts.duration, ease: 'power3.out', opacity: 1, y: 0 };
					case 'fadeLeft':
					case 'fadeRight':
						return { delay: opts.delay, duration: opts.duration, ease: 'power3.out', opacity: 1, x: 0 };
					case 'scaleUp':
						return {
							delay: opts.delay,
							duration: opts.duration,
							ease: 'back.out(1.7)',
							opacity: 1,
							scale: 1
						};
					case 'reveal':
						return {
							clipPath: 'inset(0 0% 0 0)',
							delay: opts.delay,
							duration: opts.duration,
							ease: 'power3.inOut',
							opacity: 1
						};
					default:
						return { delay: opts.delay, duration: opts.duration, ease: 'power3.out', opacity: 1, y: 0 };
				}
			};

			gsap.set(element, getInitialState());

			gsap.to(element, {
				...getFinalState(),
				scrollTrigger: {
					end: opts.end,
					markers: opts.markers,
					scrub: opts.scrub,
					start: opts.start,
					toggleActions: opts.once ? 'play none none none' : 'play reverse play reverse',
					trigger: element
				}
			});
		}, element);

		return () => ctx.revert();
	}, [opts.type, opts.duration, opts.delay, opts.start, opts.end, opts.scrub, opts.markers, opts.once]);

	return ref;
}

export function useGsapStagger<T extends HTMLElement = HTMLDivElement>(options: UseGsapOptions = {}) {
	const containerRef = useRef<T>(null);
	const opts = { ...defaultOptions, ...options };

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const children = container.querySelectorAll('[data-gsap-item]');
		if (children.length === 0) return;

		const ctx = gsap.context(() => {
			const getInitialState = () => {
				switch (opts.type) {
					case 'fadeUp':
						return { opacity: 0, y: 50 };
					case 'fadeDown':
						return { opacity: 0, y: -50 };
					case 'fadeLeft':
						return { opacity: 0, x: 50 };
					case 'fadeRight':
						return { opacity: 0, x: -50 };
					case 'scaleUp':
						return { opacity: 0, scale: 0.85 };
					default:
						return { opacity: 0, y: 50 };
				}
			};

			const getFinalState = () => {
				switch (opts.type) {
					case 'fadeUp':
					case 'fadeDown':
						return { duration: opts.duration, ease: 'power3.out', opacity: 1, y: 0 };
					case 'fadeLeft':
					case 'fadeRight':
						return { duration: opts.duration, ease: 'power3.out', opacity: 1, x: 0 };
					case 'scaleUp':
						return { duration: opts.duration, ease: 'back.out(1.7)', opacity: 1, scale: 1 };
					default:
						return { duration: opts.duration, ease: 'power3.out', opacity: 1, y: 0 };
				}
			};

			gsap.set(children, getInitialState());

			gsap.to(children, {
				...getFinalState(),
				delay: opts.delay,
				scrollTrigger: {
					end: opts.end,
					markers: opts.markers,
					start: opts.start,
					toggleActions: opts.once ? 'play none none none' : 'play reverse play reverse',
					trigger: container
				},
				stagger: opts.stagger
			});
		}, container);

		return () => ctx.revert();
	}, [opts.type, opts.duration, opts.delay, opts.stagger, opts.start, opts.end, opts.markers, opts.once]);

	return containerRef;
}

export function useGsapParallax<T extends HTMLElement = HTMLDivElement>(speed = 0.5) {
	const ref = useRef<T>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		const ctx = gsap.context(() => {
			gsap.to(element, {
				ease: 'none',
				scrollTrigger: {
					end: 'bottom top',
					scrub: true,
					start: 'top bottom',
					trigger: element
				},
				y: () => -speed * 100
			});
		}, element);

		return () => ctx.revert();
	}, [speed]);

	return ref;
}

export function useGsapTextReveal<T extends HTMLElement = HTMLDivElement>(
	options: { duration?: number; delay?: number; stagger?: number } = {}
) {
	const ref = useRef<T>(null);
	const { duration = 0.8, delay = 0, stagger = 0.02 } = options;

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		const ctx = gsap.context(() => {
			// Split text into spans if not already done
			const text = element.textContent || '';
			const words = text.split(' ');

			element.innerHTML = words
				.map(
					(word) =>
						`<span class="inline-block overflow-hidden"><span class="gsap-word inline-block">${word}</span></span>`
				)
				.join(' ');

			const wordSpans = element.querySelectorAll('.gsap-word');

			gsap.set(wordSpans, { opacity: 0, y: '100%' });

			gsap.to(wordSpans, {
				delay,
				duration,
				ease: 'power3.out',
				opacity: 1,
				scrollTrigger: {
					start: 'top 85%',
					toggleActions: 'play none none none',
					trigger: element
				},
				stagger,
				y: '0%'
			});
		}, element);

		return () => ctx.revert();
	}, [duration, delay, stagger]);

	return ref;
}

// Counter animation hook for numbers
export function useGsapCounter<T extends HTMLElement = HTMLDivElement>(
	endValue: number,
	options: { duration?: number; delay?: number; prefix?: string; suffix?: string } = {}
) {
	const ref = useRef<T>(null);
	const { duration = 2, delay = 0, prefix = '', suffix = '' } = options;

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		const ctx = gsap.context(() => {
			const counter = { value: 0 };

			gsap.to(counter, {
				delay,
				duration,
				ease: 'power2.out',
				onUpdate: () => {
					element.textContent = `${prefix}${Math.round(counter.value)}${suffix}`;
				},
				scrollTrigger: {
					start: 'top 85%',
					toggleActions: 'play none none none',
					trigger: element
				},
				value: endValue
			});
		}, element);

		return () => ctx.revert();
	}, [endValue, duration, delay, prefix, suffix]);

	return ref;
}

// Export gsap and ScrollTrigger for direct use
export { gsap, ScrollTrigger };
