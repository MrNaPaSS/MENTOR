"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Объёмный WebGL-фон лендинга, реагирующий на скролл (ТЗ §5.2, A-13).
 *
 * Свечи «вырастают» по мере прокрутки, поле частиц даёт глубину, неоновый график плывёт,
 * камера делает dolly + параллакс по курсору. Учитывает prefers-reduced-motion и чистит ресурсы.
 * Рендерится позади контента (fixed, -z-10, pointer-events:none).
 */
export default function ScrollScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return; // WebGL недоступен - остаётся CSS-фон
    }

    // Цвета и способ смешивания зависят от темы сайта.
    //
    // Складывающее смешивание светит: на чёрной странице это неон, на белой -
    // ничего, свет поверх света остаётся белым. Поэтому на светлой теме краски
    // те же, что у графика в терминале - чёрно-белые свечи и золотая линия
    // уровня, - и смешивание обычное.
    const light = document.documentElement.dataset.terminal === "light";
    const CYAN = new THREE.Color(light ? "#2962FF" : "#0AFFE0");
    const GOLD = new THREE.Color(light ? "#A97400" : "#FFD700");
    const BLEND = light ? THREE.NormalBlending : THREE.AdditiveBlending;

    // Свечи фона - те же, что в терминале: не зелёно-красные, а чёрно-белые.
    //
    // Цвет здесь ничего не значит: это фон, а не котировки, и зелёное с красным
    // обещали смысл, которого нет. Растущая свеча полая, падающая залитая - так
    // они нарисованы на белом графике терминала, и лендинг обещает ровно то,
    // что человек увидит, когда войдёт.
    //
    // INK - обводка и фитили, FILL_DOWN - тело падающей. Тело растущей красят
    // в цвет страницы: на белом оно сливается с фоном, на чёрном складывающее
    // смешивание почти ничего не прибавляет, - в обоих случаях остаётся контур.
    const INK = new THREE.Color(light ? "#000000" : "#E6EAF2");
    const FILL_UP = new THREE.Color(light ? "#FFFFFF" : "#0A0A1A");
    const FILL_DOWN = new THREE.Color(light ? "#000000" : "#E6EAF2");

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    // Туман под цвет страницы: на белой он должен уводить в белое, иначе
    // дальние свечи темнеют вместо того, чтобы растворяться.
    scene.fog = new THREE.FogExp2(light ? 0xf2f3f5 : 0x0a0a1a, 0.055);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0.5, 8);

    const root = new THREE.Group();
    scene.add(root);

    // ── Поле частиц (глубина) ──
    const COUNT = 1400;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 6;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({
      color: CYAN, size: 0.045, transparent: true, opacity: light ? 0.25 : 0.5,
      blending: BLEND, depthWrite: false,
    });
    const particles = new THREE.Points(pGeo, pMat);
    root.add(particles);

    // ── Ресидящая сетка (объёмный «пол» графика) ──
    const grid = new THREE.GridHelper(60, 60, CYAN, 0x223044);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.12;
    grid.position.y = -4;
    root.add(grid);

    // ── Свечи ──
    const N = 30;
    const spacing = 0.62;
    const bodyGeo = new THREE.BoxGeometry(0.34, 1, 0.34);
    const wickGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
    // Контур тела. Геометрия одна на все свечи, а рёбра висят внутри тела и
    // тянутся вместе с ним: у полой свечи виден только он.
    const edgeGeo = new THREE.EdgesGeometry(bodyGeo);
    const candles: {
      body: THREE.Mesh;
      wick: THREE.Mesh;
      mats: THREE.Material[];
      target: number;
      reveal: number;
      up: boolean;
    }[] = [];
    const floorY = -2.2;

    for (let i = 0; i < N; i++) {
      const up = Math.random() > 0.42;
      const target = 0.5 + Math.random() * 3.2;
      const bodyMat = new THREE.MeshBasicMaterial({
        color: up ? FILL_UP : FILL_DOWN, transparent: true, opacity: light ? 0.5 : 0.78,
        blending: BLEND, depthWrite: false,
      });
      const inkMat = new THREE.MeshBasicMaterial({
        color: INK, transparent: true, opacity: light ? 0.5 : 0.78,
        blending: BLEND, depthWrite: false,
      });
      const edgeMat = new THREE.LineBasicMaterial({
        color: INK, transparent: true, opacity: light ? 0.5 : 0.78,
        blending: BLEND, depthWrite: false,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.add(new THREE.LineSegments(edgeGeo, edgeMat));
      const wick = new THREE.Mesh(wickGeo, inkMat);
      const x = (i - N / 2) * spacing;
      const z = -2 + Math.sin(i * 0.6) * 1.4;
      body.position.set(x, floorY, z);
      wick.position.set(x, floorY, z);
      wick.scale.y = target * 1.6;
      root.add(body, wick);
      candles.push({ body, wick, mats: [bodyMat, inkMat, edgeMat], target, reveal: i / N, up });
    }

    // ── Неоновый «график» (плывущая линия) ──
    const SEG = 120;
    const linePos = new Float32Array(SEG * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: GOLD, transparent: true, opacity: light ? 0.35 : 0.45,
      blending: BLEND, depthWrite: false,
    });
    const priceLine = new THREE.Line(lineGeo, lineMat);
    priceLine.position.y = 1.5;
    root.add(priceLine);

    // ── Состояние ──
    const scrollP = { current: 0 };
    const pointer = { x: 0, y: 0 };
    const clock = new THREE.Clock();

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    function onScroll() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollP.current = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
    }
    function onPointer(e: PointerEvent) {
      pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
    }

    resize();
    onScroll();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });

    const smoothstep = (e0: number, e1: number, x: number) => {
      const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
      return t * t * (3 - 2 * t);
    };
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const p = scrollP.current;

      // Камера: dolly внутрь + параллакс по курсору + лёгкий подъём
      camera.position.x = lerp(camera.position.x, pointer.x * 0.9, 0.04);
      camera.position.y = lerp(camera.position.y, 0.5 - pointer.y * 0.5 + p * 1.2, 0.04);
      camera.position.z = lerp(camera.position.z, 8 - p * 3.2, 0.04);
      camera.lookAt(0, p * 0.6, 0);

      // Общий разворот сцены по скроллу
      root.rotation.y = p * Math.PI * 0.55 + Math.sin(t * 0.1) * 0.05;
      particles.rotation.y = t * 0.02;

      // Свечи «вырастают» по мере скролла
      for (const c of candles) {
        const grow = smoothstep(c.reveal - 0.15, c.reveal + 0.2, p + 0.12);
        const breathe = 1 + Math.sin(t * 1.5 + c.reveal * 10) * 0.04;
        const h = Math.max(c.target * grow * breathe, 0.0001);
        c.body.scale.y = h;
        c.body.position.y = floorY + h / 2;
        // Тело, фитиль и контур гаснут вместе: разъехавшись, они дали бы
        // висящий в воздухе контур без свечи.
        for (const m of c.mats) m.opacity = 0.25 + grow * 0.6;
        c.wick.position.y = floorY + h / 2;
      }

      // Плывущий неоновый график
      const arr = lineGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < SEG; i++) {
        const x = (i - SEG / 2) * 0.16;
        arr[i * 3] = x;
        arr[i * 3 + 1] = Math.sin(i * 0.25 + t * 0.9) * 0.5 + Math.sin(i * 0.07 + t * 0.4) * 0.9;
        arr[i * 3 + 2] = -3;
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineMat.opacity = 0.2 + p * 0.4;

      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointer);
      bodyGeo.dispose();
      wickGeo.dispose();
      edgeGeo.dispose();
      pGeo.dispose();
      lineGeo.dispose();
      pMat.dispose();
      lineMat.dispose();
      candles.forEach((c) => c.mats.forEach((m) => m.dispose()));
      (grid.material as THREE.Material).dispose();
      grid.geometry.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="h-full w-full"
    />
  );
}
